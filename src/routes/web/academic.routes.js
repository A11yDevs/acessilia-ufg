import { academicService } from '../../services/academic.service.js';
import { academicRepository } from '../../repositories/academic.repository.js';

export async function academicWebRoutes(fastify, opts) {
  // Listagem de Cursos
  fastify.get('/academico/cursos', {
    preHandler: [fastify.requirePermission('cursos.visualizar')]
  }, async (request, reply) => {
    const courses = await academicService.listCourses();
    const departments = academicRepository.listDepartments();
    const csrfToken = reply.generateCsrf();

    return reply.view('layouts/base.ejs', {
      title: 'Gestão de Cursos',
      headerTitle: 'Cursos da Instituição',
      currentPath: '/academico/cursos',
      csrfToken,
      user: request.user,
      body: await fastify.view('academic/courses.ejs', {
        courses,
        departments,
        user: request.user,
        csrfToken
      })
    });
  });

  // Criação de Curso
  fastify.post('/academico/cursos', {
    preHandler: [fastify.requirePermission('cursos.gerenciar'), fastify.csrfProtection]
  }, async (request, reply) => {
    const { departmentId, code, name, modality, durationSemesters } = request.body || {};
    try {
      await academicService.createCourse({
        departmentId: parseInt(departmentId, 10),
        code,
        name,
        modality,
        durationSemesters: parseInt(durationSemesters, 10)
      }, request.user);
      return reply.redirect('/academico/cursos');
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Detalhes do Curso e Matriz de Disciplinas
  fastify.get('/academico/cursos/:id', {
    preHandler: [fastify.requirePermission('cursos.visualizar')]
  }, async (request, reply) => {
    const course = academicRepository.findCourseById(request.params.id);
    if (!course) return reply.status(404).send('Curso não encontrado');

    const courseSubjects = await academicService.getCourseSubjects(course.id);
    const allSubjects = await academicService.listSubjects();
    const csrfToken = reply.generateCsrf();

    return reply.view('layouts/base.ejs', {
      title: `${course.name} — Matriz Curricular`,
      headerTitle: `Curso: ${course.name}`,
      currentPath: '/academico/cursos',
      csrfToken,
      user: request.user,
      body: await fastify.view('academic/course-detail.ejs', {
        course,
        courseSubjects,
        allSubjects,
        user: request.user,
        csrfToken
      })
    });
  });

  // Vincular Disciplina ao Curso
  fastify.post('/academico/cursos/:id/disciplinas', {
    preHandler: [fastify.requirePermission('cursos.gerenciar'), fastify.csrfProtection]
  }, async (request, reply) => {
    const courseId = parseInt(request.params.id, 10);
    const { subjectId, recommendedSemester, isMandatory } = request.body || {};
    await academicService.linkSubjectToCourse(
      courseId,
      parseInt(subjectId, 10),
      parseInt(recommendedSemester, 10),
      Boolean(isMandatory),
      request.user
    );
    return reply.redirect(`/academico/cursos/${courseId}`);
  });
}
