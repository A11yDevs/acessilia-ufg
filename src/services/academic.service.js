import { academicRepository } from '../repositories/academic.repository.js';
import { auditRepository } from '../repositories/audit.repository.js';

export const academicService = {
  // Cursos
  async listCourses() {
    return academicRepository.listCourses();
  },

  async createCourse(data, actorUser) {
    if (!data.name || !data.code || !data.departmentId) {
      throw new Error('Nome, código e departamento são obrigatórios.');
    }
    const course = academicRepository.createCourse(data);
    auditRepository.createLog({
      userId: actorUser.id,
      action: 'CRIAR_CURSO',
      resource: 'courses',
      resourceId: course.id,
      details: { code: course.code, name: course.name }
    });
    return course;
  },

  // Disciplinas e Matriz
  async listSubjects() {
    return academicRepository.listSubjects();
  },

  async createSubject(data, actorUser) {
    if (!data.name || !data.code || !data.departmentId || !data.workloadHours) {
      throw new Error('Nome, código, departamento e carga horária são obrigatórios.');
    }
    const subject = academicRepository.createSubject(data);
    auditRepository.createLog({
      userId: actorUser.id,
      action: 'CRIAR_DISCIPLINA',
      resource: 'subjects',
      resourceId: subject.id,
      details: { code: subject.code, name: subject.name }
    });
    return subject;
  },

  async linkSubjectToCourse(courseId, subjectId, recommendedSemester, isMandatory, actorUser) {
    academicRepository.linkSubjectToCourse({ courseId, subjectId, recommendedSemester, isMandatory });
    auditRepository.createLog({
      userId: actorUser.id,
      action: 'VINCULAR_DISCIPLINA_CURSO',
      resource: 'course_subjects',
      details: { courseId, subjectId, recommendedSemester, isMandatory }
    });
  },

  async getCourseSubjects(courseId) {
    return academicRepository.getCourseSubjects(courseId);
  },

  // Turmas
  async listClasses(filters) {
    return academicRepository.listClasses(filters);
  },

  async createClass(data, actorUser) {
    if (!data.courseId || !data.subjectId || !data.academicPeriodId || !data.code) {
      throw new Error('Curso, disciplina, período letivo e código da turma são obrigatórios.');
    }
    const newClass = academicRepository.createClass(data);
    auditRepository.createLog({
      userId: actorUser.id,
      action: 'CRIAR_TURMA',
      resource: 'classes',
      resourceId: newClass.id,
      details: { code: newClass.code, courseId: data.courseId, subjectId: data.subjectId }
    });
    return newClass;
  },

  async enrollStudent(classId, studentUserId, actorUser) {
    academicRepository.enrollStudentInClass(classId, studentUserId);
    auditRepository.createLog({
      userId: actorUser.id,
      action: 'MATRICULAR_ALUNO',
      resource: 'class_students',
      details: { classId, studentUserId }
    });
  },

  async assignTeacher(classId, teacherUserId, roleInClass, actorUser) {
    academicRepository.assignTeacherToClass(classId, teacherUserId, roleInClass);
    auditRepository.createLog({
      userId: actorUser.id,
      action: 'ATRIBUIR_PROFESSOR_TURMA',
      resource: 'class_teachers',
      details: { classId, teacherUserId, roleInClass }
    });
  }
};
