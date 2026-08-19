'use strict';
require('dotenv').config();
const cursos = require('../server/cursos');

(async () => {
  const all = await cursos.loadCourseNames();
  console.log('total cursos únicos:', all.length);
  const sample = await cursos.searchCourses('admin');
  console.log('preview "admin":', sample.join(' | '));
})().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
