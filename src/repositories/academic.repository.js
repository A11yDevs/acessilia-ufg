import { db } from '../../database/connection.js';

export const academicRepository = {
  // Departamentos
  listDepartments() {
    return db.prepare(`
      SELECT d.*, c.name as campus_name, i.name as institution_name
      FROM departments d
      JOIN campuses c ON c.id = d.campus_id
      JOIN institutions i ON i.id = c.institution_id
      WHERE d.status = 'ACTIVE'
      ORDER BY d.name ASC
    `).all();
  },

  // Cursos
  listCourses() {
    return db.prepare(`
      SELECT c.*, d.name as department_name, d.code as department_code
      FROM courses c
      JOIN departments d ON d.id = c.department_id
      ORDER BY c.name ASC
    `).all();
  },

  findCourseById(id) {
    return db.prepare(`
      SELECT c.*, d.name as department_name, d.code as department_code
      FROM courses c
      JOIN departments d ON d.id = c.department_id
      WHERE c.id = ?
    `).get(id);
  },

  createCourse({ departmentId, code, name, modality, durationSemesters }) {
    const stmt = db.prepare(`
      INSERT INTO courses (department_id, code, name, modality, duration_semesters, status)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE')
    `);
    const info = stmt.run(departmentId, code.trim().toUpperCase(), name.trim(), modality, durationSemesters);
    return this.findCourseById(info.lastInsertRowid);
  },

  // Disciplinas
  listSubjects() {
    return db.prepare(`
      SELECT s.*, d.name as department_name, d.code as department_code
      FROM subjects s
      JOIN departments d ON d.id = s.department_id
      ORDER BY s.name ASC
    `).all();
  },

  findSubjectById(id) {
    return db.prepare(`
      SELECT s.*, d.name as department_name, d.code as department_code
      FROM subjects s
      JOIN departments d ON d.id = s.department_id
      WHERE s.id = ?
    `).get(id);
  },

  createSubject({ departmentId, code, name, description = null, workloadHours }) {
    const stmt = db.prepare(`
      INSERT INTO subjects (department_id, code, name, description, workload_hours, status)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE')
    `);
    const info = stmt.run(departmentId, code.trim().toUpperCase(), name.trim(), description, workloadHours);
    return this.findSubjectById(info.lastInsertRowid);
  },

  // Matriz Curricular M:N (course_subjects)
  linkSubjectToCourse({ courseId, subjectId, recommendedSemester, isMandatory = 1 }) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO course_subjects (course_id, subject_id, recommended_semester, is_mandatory)
      VALUES (?, ?, ?, ?)
    `);
    return stmt.run(courseId, subjectId, recommendedSemester, isMandatory ? 1 : 0);
  },

  getCourseSubjects(courseId) {
    return db.prepare(`
      SELECT cs.*, s.code as subject_code, s.name as subject_name, s.workload_hours
      FROM course_subjects cs
      JOIN subjects s ON s.id = cs.subject_id
      WHERE cs.course_id = ?
      ORDER BY cs.recommended_semester ASC, s.name ASC
    `).all(courseId);
  },

  // Períodos Letivos
  listPeriods() {
    return db.prepare(`
      SELECT * FROM academic_periods
      ORDER BY start_date DESC
    `).all();
  },

  getActivePeriod() {
    return db.prepare(`
      SELECT * FROM academic_periods
      WHERE is_active = 1
      LIMIT 1
    `).get();
  },

  // Turmas
  listClasses({ courseId = null, subjectId = null, periodId = null } = {}) {
    let sql = `
      SELECT cl.*,
             c.name as course_name, c.code as course_code,
             s.name as subject_name, s.code as subject_code,
             ap.code as period_code,
             (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = cl.id) as total_students
      FROM classes cl
      JOIN courses c ON c.id = cl.course_id
      JOIN subjects s ON s.id = cl.subject_id
      JOIN academic_periods ap ON ap.id = cl.academic_period_id
      WHERE 1=1
    `;
    const params = [];
    if (courseId) { sql += ` AND cl.course_id = ?`; params.push(courseId); }
    if (subjectId) { sql += ` AND cl.subject_id = ?`; params.push(subjectId); }
    if (periodId) { sql += ` AND cl.academic_period_id = ?`; params.push(periodId); }

    sql += ` ORDER BY ap.code DESC, s.name ASC, cl.code ASC`;
    return db.prepare(sql).all(...params);
  },

  findClassById(id) {
    return db.prepare(`
      SELECT cl.*,
             c.name as course_name, c.code as course_code,
             s.name as subject_name, s.code as subject_code,
             ap.code as period_code
      FROM classes cl
      JOIN courses c ON c.id = cl.course_id
      JOIN subjects s ON s.id = cl.subject_id
      JOIN academic_periods ap ON ap.id = cl.academic_period_id
      WHERE cl.id = ?
    `).get(id);
  },

  createClass({ courseId, subjectId, academicPeriodId, code, location = null, scheduleDescription = null }) {
    const stmt = db.prepare(`
      INSERT INTO classes (course_id, subject_id, academic_period_id, code, location, schedule_description, status)
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
    `);
    const info = stmt.run(courseId, subjectId, academicPeriodId, code.trim().toUpperCase(), location, scheduleDescription);
    return this.findClassById(info.lastInsertRowid);
  },

  // Vinculação de Professores à Turma
  assignTeacherToClass(classId, teacherUserId, roleInClass = 'TITULAR') {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO class_teachers (class_id, teacher_user_id, role_in_class)
      VALUES (?, ?, ?)
    `);
    return stmt.run(classId, teacherUserId, roleInClass);
  },

  // Vinculação de Alunos à Turma
  enrollStudentInClass(classId, studentUserId) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO class_students (class_id, student_user_id, status)
      VALUES (?, ?, 'MATRICULADO')
    `);
    return stmt.run(classId, studentUserId);
  },

  // Checagem de Vínculo (Escopo de Objeto)
  isTeacherOfClass(teacherUserId, classId) {
    const row = db.prepare(`
      SELECT 1 FROM class_teachers WHERE class_id = ? AND teacher_user_id = ?
    `).get(classId, teacherUserId);
    return Boolean(row);
  },

  isStudentInClass(studentUserId, classId) {
    const row = db.prepare(`
      SELECT 1 FROM class_students WHERE class_id = ? AND student_user_id = ? AND status = 'MATRICULADO'
    `).get(classId, studentUserId);
    return Boolean(row);
  }
};
