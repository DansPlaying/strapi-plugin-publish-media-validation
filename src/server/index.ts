import type { Core, UID } from '@strapi/strapi';

type ValidationErrorCtor = new (message: string) => Error;

function resolveValidationError(): ValidationErrorCtor {
  try {
    // @strapi/utils is always present in the host Strapi project; require()
    // loads the CJS build, which is the same instance Strapi's error
    // middleware uses for instanceof checks → errors become 400, not 500.
    return (require('@strapi/utils') as any).errors.ValidationError;
  } catch {
    return class extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'ValidationError';
        (this as any).status = 400;
      }
    };
  }
}

/**
 * Recursively build a Strapi populate object that covers every media field
 * (at any depth) inside the given model, including inside components and
 * dynamic zones. The visited set prevents infinite loops from circular
 * component references.
 */
function buildPopulate(
  modelUID: string,
  strapi: Core.Strapi,
  visited = new Set<string>()
): Record<string, any> {
  if (visited.has(modelUID)) return {};
  const seen = new Set(visited);
  seen.add(modelUID);

  const model = strapi.getModel(modelUID as UID.Schema);
  if (!model?.attributes) return {};

  const populate: Record<string, any> = {};

  for (const [key, attr] of Object.entries(model.attributes)) {
    const a = attr as any;

    if (a.type === 'media') {
      populate[key] = true;
    } else if (a.type === 'component') {
      const nested = buildPopulate(a.component, strapi, seen);
      // Always include the component so we can inspect its fields; fall back
      // to populate:'*' when there are no explicitly known nested keys.
      populate[key] = { populate: Object.keys(nested).length ? nested : '*' };
    } else if (a.type === 'dynamiczone') {
      // Use the per-component 'on' syntax so nested components inside
      // each dynamic zone block are recursively populated. A plain '*'
      // only goes one level deep, causing false-positive "missing media"
      // errors when a block contains a component that itself has media.
      if (a.components && Array.isArray(a.components) && a.components.length > 0) {
        const on: Record<string, any> = {};
        for (const compUID of a.components as string[]) {
          const nested = buildPopulate(compUID, strapi, seen);
          on[compUID] = Object.keys(nested).length ? { populate: nested } : {};
        }
        populate[key] = { on };
      } else {
        populate[key] = { populate: '*' };
      }
    }
  }

  return populate;
}

/**
 * Walk the fetched document data and collect human-readable paths for every
 * required media field that is empty. Handles nested components and dynamic
 * zones recursively.
 */
function collectMissingMedia(
  data: any,
  modelUID: string,
  strapi: Core.Strapi
): string[] {
  if (!data) return [];

  const model = strapi.getModel(modelUID as UID.Schema);
  if (!model?.attributes) return [];

  const missing: string[] = [];

  for (const [key, attr] of Object.entries(model.attributes)) {
    const a = attr as any;

    if (a.type === 'media' && a.required === true) {
      if (!data[key]) {
        missing.push(key);
      }
    } else if (a.type === 'component' && data[key] != null) {
      const items: any[] = Array.isArray(data[key]) ? data[key] : [data[key]];
      items.forEach((item, i) => {
        const prefix = Array.isArray(data[key]) ? `${key}[${i + 1}]` : key;
        collectMissingMedia(item, a.component, strapi).forEach((f) =>
          missing.push(`${prefix} > ${f}`)
        );
      });
    } else if (a.type === 'dynamiczone' && Array.isArray(data[key])) {
      data[key].forEach((item: any, i: number) => {
        const compUID: string | undefined = item?.__component;
        if (compUID) {
          collectMissingMedia(item, compUID, strapi).forEach((f) =>
            missing.push(`${key}[${i + 1}] > ${f}`)
          );
        }
      });
    }
  }

  return missing;
}

const register = ({ strapi }: { strapi: Core.Strapi }) => {
  const ValidationError = resolveValidationError();

  strapi.documents.use(async (ctx, next) => {
    if (ctx.action !== 'publish') return next();

    const model = strapi.getModel(ctx.uid as UID.ContentType);
    if (!model?.attributes) return next();

    const documentId = (ctx.params as { documentId?: string })?.documentId;
    if (!documentId) return next();

    let missing: string[] = [];

    try {
      const populate = buildPopulate(ctx.uid as string, strapi);

      if (Object.keys(populate).length > 0) {
        const doc = await strapi.documents(ctx.uid as UID.ContentType).findOne({
          documentId,
          populate,
        });

        missing = collectMissingMedia(doc, ctx.uid as string, strapi);
      }
    } catch (err) {
      // Re-throw only our own validation errors; swallow unexpected plugin
      // errors so a bug here never blocks a legitimate publish.
      if (err instanceof ValidationError) throw err;
      strapi.log.warn(
        `[publish-media-validation] Skipping validation due to unexpected error: ${err}`
      );
      return next();
    }

    if (missing.length > 0) {
      const labels = missing
        .map((rawPath) =>
          rawPath
            .split(' > ')
            .map((seg) => {
              const indexed = seg.match(/^(.+?)\[(\d+)\]$/);
              if (indexed) {
                const name = indexed[1].charAt(0).toUpperCase() +
                  indexed[1].slice(1).replace(/([A-Z])/g, ' $1').replace(/_/g, ' ');
                return `${name} (item ${indexed[2]})`;
              }
              return seg.charAt(0).toUpperCase() +
                seg.slice(1).replace(/([A-Z])/g, ' $1').replace(/_/g, ' ');
            })
            .join(' › ')
        )
        .join(', ');

      const verb = missing.length === 1 ? 'field is' : 'fields are';
      throw new ValidationError(
        `Cannot publish: required media ${verb} missing — ${labels}`
      );
    }

    return next();
  });
};

const bootstrap = (_args: { strapi: Core.Strapi }) => {};
const destroy = (_args: { strapi: Core.Strapi }) => {};

export default { register, bootstrap, destroy };
