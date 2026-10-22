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
    const departments = academicRepository.listDepartments();
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
        departments,
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

  // Listagem de Disciplinas
  fastify.get('/academico/disciplinas', {
    preHandler: [fastify.requirePermission('cursos.visualizar')]
  }, async (request, reply) => {
    const subjects = await academicService.listSubjects();
    const departments = academicRepository.listDepartments();
    const csrfToken = reply.generateCsrf();

    return reply.view('layouts/base.ejs', {
      title: 'Catálogo de Disciplinas',
      headerTitle: 'Disciplinas da Instituição',
      currentPath: '/academico/disciplinas',
      csrfToken,
      user: request.user,
      body: await fastify.view('academic/subjects.ejs', {
        subjects,
        departments,
        user: request.user,
        csrfToken
      })
    });
  });

  // Criação de Nova Disciplina
  fastify.post('/academico/disciplinas', {
    preHandler: [fastify.requirePermission('cursos.gerenciar'), fastify.csrfProtection]
  }, async (request, reply) => {
    const { departmentId, code, name, description, workloadHours, redirectUrl } = request.body || {};
    try {
      await academicService.createSubject({
        departmentId: parseInt(departmentId, 10),
        code,
        name,
        description: description || null,
        workloadHours: parseInt(workloadHours, 10)
      }, request.user);
      const cleanRedirectUrl = (redirectUrl || '/academico/disciplinas').replace(/^\/gestor/, '');
      return reply.redirect(cleanRedirectUrl);
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // ==========================================
  // GESTÃO DE TURMAS (CLASSES)
  // ==========================================

  // Listagem de Turmas
  fastify.get('/academico/turmas', {
    preHandler: [fastify.requirePermission('turmas.visualizar')]
  }, async (request, reply) => {
    const { courseId, subjectId, periodId } = request.query || {};
    const classes = await academicService.listClasses({
      courseId: courseId ? parseInt(courseId, 10) : null,
      subjectId: subjectId ? parseInt(subjectId, 10) : null,
      periodId: periodId ? parseInt(periodId, 10) : null
    });

    const courses = await academicService.listCourses();
    const subjects = await academicService.listSubjects();
    const periods = academicRepository.listPeriods();
    const activePeriod = academicRepository.getActivePeriod();
    const teachers = academicRepository.listTeachers();
    const students = academicRepository.listStudents();
    const csrfToken = reply.generateCsrf();

    return reply.view('layouts/base.ejs', {
      title: 'Gestão de Turmas',
      headerTitle: 'Turmas e Enturmações',
      currentPath: '/academico/turmas',
      csrfToken,
      user: request.user,
      body: await fastify.view('academic/classes.ejs', {
        classes,
        courses,
        subjects,
        periods,
        activePeriod,
        teachers,
        students,
        filters: { courseId, subjectId, periodId },
        user: request.user,
        csrfToken
      })
    });
  });

  // Criação de Nova Turma
  fastify.post('/academico/turmas', {
    preHandler: [fastify.requirePermission('turmas.gerenciar'), fastify.csrfProtection]
  }, async (request, reply) => {
    const { courseId, subjectId, academicPeriodId, code, location, scheduleDescription, teacherUserId } = request.body || {};
    try {
      const newClass = await academicService.createClass({
        courseId: parseInt(courseId, 10),
        subjectId: parseInt(subjectId, 10),
        academicPeriodId: parseInt(academicPeriodId, 10),
        code: (code || '').trim(),
        location: location ? location.trim() : null,
        scheduleDescription: scheduleDescription ? scheduleDescription.trim() : null
      }, request.user);

      if (teacherUserId) {
        await academicService.assignTeacher(newClass.id, parseInt(teacherUserId, 10), 'TITULAR', request.user);
      }

      return reply.redirect('/academico/turmas');
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Detalhes da Turma em JSON (para modais de enturmação)
  fastify.get('/academico/turmas/:id/detalhes', {
    preHandler: [fastify.requirePermission('turmas.visualizar')]
  }, async (request, reply) => {
    const classId = parseInt(request.params.id, 10);
    const detail = await academicService.getClassDetail(classId);
    if (!detail) return reply.status(404).send({ error: 'Turma não encontrada' });
    return reply.send(detail);
  });

  // Atribuir Professor à Turma
  fastify.post('/academico/turmas/:id/professores', {
    preHandler: [fastify.requirePermission('turmas.gerenciar'), fastify.csrfProtection]
  }, async (request, reply) => {
    const classId = parseInt(request.params.id, 10);
    const { teacherUserId, roleInClass } = request.body || {};
    try {
      await academicService.assignTeacher(classId, parseInt(teacherUserId, 10), roleInClass || 'TITULAR', request.user);
      return reply.redirect('/academico/turmas');
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Remover Professor da Turma
  fastify.post('/academico/turmas/:id/professores/:teacherId/remover', {
    preHandler: [fastify.requirePermission('turmas.gerenciar'), fastify.csrfProtection]
  }, async (request, reply) => {
    const classId = parseInt(request.params.id, 10);
    const teacherUserId = parseInt(request.params.teacherId, 10);
    try {
      await academicService.removeTeacher(classId, teacherUserId, request.user);
      return reply.redirect('/academico/turmas');
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Matricular Aluno na Turma
  fastify.post('/academico/turmas/:id/alunos', {
    preHandler: [fastify.requirePermission('turmas.gerenciar'), fastify.csrfProtection]
  }, async (request, reply) => {
    const classId = parseInt(request.params.id, 10);
    const { studentUserId } = request.body || {};
    try {
      await academicService.enrollStudent(classId, parseInt(studentUserId, 10), request.user);
      return reply.redirect('/academico/turmas');
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Desvincular Aluno da Turma
  fastify.post('/academico/turmas/:id/alunos/:studentId/remover', {
    preHandler: [fastify.requirePermission('turmas.gerenciar'), fastify.csrfProtection]
  }, async (request, reply) => {
    const classId = parseInt(request.params.id, 10);
    const studentUserId = parseInt(request.params.studentId, 10);
    try {
      await academicService.removeStudent(classId, studentUserId, request.user);
      return reply.redirect('/academico/turmas');
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });
}
