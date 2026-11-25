// Dados próprios para os testes de integração.
//
// Vários testes usavam IDs fixos (disciplina 1, curso 1, material 9, "o primeiro material do
// banco") que só existem no banco de desenvolvimento de quem escreveu o teste. Com um banco
// criado só por `npm run migrate` + `npm run seed`, 20 testes falhavam. Estes helpers criam o
// que cada teste precisa sobre o que o seed garante (departamento 1, período 1 e usuários).
import { academicService } from '../../src/services/academic.service.js';
import { materialService } from '../../src/services/material.service.js';

// Usuários do seed (database/seed.js)
export const ADMIN = { id: 1, roleCode: 'ADMINISTRADOR', name: 'Administrador UFG', permissions: [] };
export const TEACHER = { id: 2, roleCode: 'PROFESSOR', name: 'Prof. Carlos' };

let sequence = 0;
const unique = (label) => `${label}-${process.pid}-${Date.now()}-${++sequence}`;

/** Curso e disciplina novos no departamento 1 do seed. */
export async function createAcademicBase(label = 'BASE') {
  const code = unique(label);
  const course = await academicService.createCourse({
    departmentId: 1, code: `CUR-${code}`, name: `Curso de teste ${code}`, modality: 'PRESENCIAL', durationSemesters: 8
  }, ADMIN);
  const subject = await academicService.createSubject({
    departmentId: 1, code: `DIS-${code}`, name: `Disciplina de teste ${code}`, workloadHours: 60
  }, ADMIN);
  return { course, subject };
}

/** Material com a versão original (sem arquivo em disco, como nos demais testes de serviço). */
export async function createMaterial({ subjectId, teacher = TEACHER, title, category = 'APOSTILA', originalFilename = 'material.pdf' } = {}) {
  const subject = subjectId || (await createAcademicBase('MAT')).subject.id;
  return materialService.uploadMaterial({
    subjectId: subject,
    title: title || `Material de teste ${unique('M')}`,
    category,
    originalFilename
  }, teacher);
}
