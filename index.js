/**
 * Responds to any HTTP request.
 *
 * @param {!express:Request} req HTTP request context.
 * @param {!express:Response} res HTTP response context.
 */
const { default: axios } = require("axios");
const moment = require("moment");
require("moment/locale/nl");
moment.locale("nl");
const admin = require("firebase-admin");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");
const firebaseCredentials = require("./firebase.json");
initializeApp({ credential: cert(firebaseCredentials) });

exports.rivm_cases_deaths_hospitalizations = async (req, res) => {
  const db = getFirestore();
  const templateDoc = await db.collection("templates").doc("cases_deaths_hospitalizations").get();
  let template = templateDoc.data().template;
  // datasets
  const { data } = await axios({ url: "https://data.rivm.nl/covid-19/COVID-19_aantallen_gemeente_per_dag.json" });
  const { data: hospitalData } = await axios({ url: "https://data.rivm.nl/covid-19/COVID-19_ziekenhuisopnames.json" });

  let result = {};
  let sum = 0;

  // cases/deaths
  data.forEach((d) => {
    let day = moment(d["Date_of_publication"], "YYYY-MM-DD");
    if (!result[day]) result[day] = { day: d["Date_of_publication"], deceased: 0, reported: 0, hospital: 0 };
    result[day].reported += d["Total_reported"];
    result[day].deceased += d["Deceased"];
    sum += d["Total_reported"];
  });

  // hospital admissions
  hospitalData.forEach((h) => {
    let day = moment(h["Date_of_statistics"], "YYYY-MM-DD");
    if (result[day] != null) result[day].hospital += h["Hospital_admission"];
  });

  let resultWeekly = [];

  // convert to weekly arrays
  Object.keys(result).forEach((k) => {
    let isoWeek = moment(new Date(k)).week();
    let week = `${moment(new Date(k)).isoWeekYear()} week ${isoWeek < 10 ? `0` : ``}${isoWeek}`;
    if (!resultWeekly[week]) resultWeekly[week] = { deceased: [], reported: [], hospital: [], day: [] };
    Object.keys(result[k]).forEach((kr) => {
      resultWeekly[week][kr].push(result[k][kr]);
    });
  });

  // formatter for template line
  const formatLine = (array, week, length, i) => `<!-- ${week} --> ${array.join(", ")}${i != length - 1 ? `,\n` : ``}`;

  let a = [];
  let templateLines = { average: "" };

  // create lines and calculate average
  let resultWeeklyKeys = Object.keys(resultWeekly);
  let length = resultWeeklyKeys.length;
  resultWeeklyKeys.forEach((k, i) => {
    let averages = [];
    // calculate weekly average
    resultWeekly[k].reported.forEach((c) => {
      if (a.length === 7) a.shift();
      a.push(c);
      averages.push(Math.floor(a.reduce((a, b) => a + b) / a.length));
    });
    // format string lines
    Object.keys(resultWeekly[k]).forEach((kw) => {
      if (templateLines[kw] == null) templateLines[kw] = "";
      templateLines[kw] += formatLine(resultWeekly[k][kw], k, length, i);
    });
    templateLines.average += formatLine(averages, k, length, i);
  });

  // generate template
  template = template
    .replace(/##deceased/g, templateLines.deceased)
    .replace(/##days/g, templateLines.day)
    .replace(/##cases/g, templateLines.reported)
    .replace(/##hospital/g, templateLines.hospital)
    .replace(/##weekaverage/g, templateLines.average)
    .replace(/##date/g, moment().format("D MMMM YYYY"));

  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET");

  // return res.status(200).send(template.trim());
  return res.status(200).send(`${sum}`);
};
