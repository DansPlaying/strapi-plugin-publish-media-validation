import type { Core, UID } from '@strapi/strapi';
import { errors } from '@strapi/utils';

const register = ({ strapi }: { strapi: Core.Strapi }) => {
  strapi.documents.use(async (ctx, next) => {
    if (ctx.action !== 'publish') return next();

    const model = strapi.getModel(ctx.uid as UID.ContentType);
    if (!model?.attributes) return next();

    const requiredMediaFields = Object.entries(model.attributes)
      .filter(([, attr]) => (attr as any).type === 'media' && (attr as any).required === true)
      .map(([key]) => key);

    if (requiredMediaFields.length === 0) return next();

    const documentId = (ctx.params as { documentId?: string })?.documentId;
    if (!documentId) return next();

    const populate = Object.fromEntries(requiredMediaFields.map((f) => [f, true]));
    const doc = await strapi.documents(ctx.uid as UID.ContentType).findOne({
      documentId,
      populate,
    });

    const missing = requiredMediaFields.filter((f) => !(doc as any)?.[f]);

    if (missing.length > 0) {
      const labels = missing
        .map((f) => f.charAt(0).toUpperCase() + f.slice(1).replace(/([A-Z])/g, ' $1'))
        .join(', ');
      throw new errors.ValidationError(
        `The following required media fields are empty: ${labels}`
      );
    }

    return next();
  });
};

const bootstrap = (_args: { strapi: Core.Strapi }) => {};
const destroy = (_args: { strapi: Core.Strapi }) => {};

export default { register, bootstrap, destroy };
