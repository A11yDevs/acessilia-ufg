import fp from 'fastify-plugin';

async function formErrorPlugin(fastify, opts) {
  fastify.decorateReply('formError', async function (viewPath, viewData, errors, options = {}) {
    const request = this.request;
    const acceptsHtml = request.headers.accept && request.headers.accept.includes('text/html');
    const statusCode = options.status || 400;

    const errorMessage = typeof errors === 'string'
      ? errors
      : (errors?.error || errors?.message || (Array.isArray(errors) ? errors[0]?.message || errors[0] : 'Dados inválidos no formulário.'));

    // Para clientes de API ou testes sem header Accept text/html, retorna JSON puro
    if (!acceptsHtml) {
      return this.status(statusCode).send({ error: errorMessage });
    }

    // Para navegadores e leitores de tela (Accept: text/html), renderiza novamente o formulário acessível
    const csrfToken = this.generateCsrf ? this.generateCsrf() : '';
    const formErrorsList = Array.isArray(errors)
      ? errors.map(e => (typeof e === 'string' ? { message: e } : e))
      : [{ message: errorMessage }];
    const formValues = options.formValues || request.body || {};

    const innerData = {
      ...viewData,
      csrfToken,
      user: request.user,
      formError: errorMessage,
      formErrors: formErrorsList,
      formValues
    };

    const renderedBody = await fastify.view(viewPath, innerData);

    return this.status(statusCode).view('layouts/base.ejs', {
      title: options.title || viewData.title || 'Acessilia Gestor',
      headerTitle: options.headerTitle || viewData.headerTitle || 'Acessilia Gestor',
      currentPath: options.currentPath || viewData.currentPath || request.url,
      csrfToken,
      user: request.user,
      formError: errorMessage,
      formErrors: formErrorsList,
      formValues,
      body: renderedBody
    });
  });
}

export default fp(formErrorPlugin);
