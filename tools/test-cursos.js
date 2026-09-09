'use strict';
require('dotenv').config();
const db = require('../server/db');
const cursos = require('../server/cursos');

(async () => {
  const pool = db.createPool();
  try {
    const all = await cursos.loadCourseNames(pool);
    console.log('total cursos únicos:', all.length);
    const sample = await cursos.searchCourses(pool, 'admin');
    console.log('preview "admin":', sample.join(' | '));
  } finally {
    await pool.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
