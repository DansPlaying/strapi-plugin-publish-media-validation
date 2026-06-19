import { errors } from '@strapi/utils';
import plugin from '../index';

// Capture the middleware function registered via strapi.documents.use()
function buildStrapi(
  modelAttributes: Record<string, unknown> | null,
  docFields: Record<string, unknown> | null = {}
) {
  let capturedMiddleware: Function | null = null;

  const strapi = {
    documents: Object.assign(
      (uid: string) => ({
        findOne: jest.fn().mockResolvedValue(docFields),
      }),
      {
        use: jest.fn((fn: Function) => {
          capturedMiddleware = fn;
        }),
      }
    ),
    getModel: jest.fn().mockReturnValue(
      modelAttributes !== null ? { attributes: modelAttributes } : null
    ),
  };

  plugin.register({ strapi: strapi as any });

  return {
    strapi,
    runMiddleware: (ctx: Record<string, unknown>) => {
      if (!capturedMiddleware) throw new Error('middleware not registered');
      const next = jest.fn().mockResolvedValue(undefined);
      return { result: capturedMiddleware(ctx, next), next };
    },
  };
}

const baseCtx = {
  action: 'publish',
  uid: 'api::article.article',
  params: { documentId: 'abc123' },
};

describe('register', () => {
  it('calls strapi.documents.use once', () => {
    const { strapi } = buildStrapi({});
    expect(strapi.documents.use).toHaveBeenCalledTimes(1);
  });
});

describe('middleware', () => {
  it('passes through when action is not publish', async () => {
    const { runMiddleware } = buildStrapi({});
    const { next } = runMiddleware({ ...baseCtx, action: 'create' });
    await next;
    expect(next).toHaveBeenCalled();
  });

  it('passes through when model is null', async () => {
    const { runMiddleware } = buildStrapi(null);
    const { next } = runMiddleware(baseCtx);
    await next;
    expect(next).toHaveBeenCalled();
  });

  it('passes through when model has no required media fields', async () => {
    const { runMiddleware } = buildStrapi({
      title: { type: 'string', required: true },
      cover: { type: 'media', required: false },
    });
    const { next } = runMiddleware(baseCtx);
    await next;
    expect(next).toHaveBeenCalled();
  });

  it('passes through when there is no documentId', async () => {
    const { runMiddleware } = buildStrapi({
      cover: { type: 'media', required: true },
    });
    const { next } = runMiddleware({ ...baseCtx, params: {} });
    await next;
    expect(next).toHaveBeenCalled();
  });

  it('passes through when all required media fields are populated', async () => {
    const { runMiddleware } = buildStrapi(
      { cover: { type: 'media', required: true } },
      { cover: { id: 1, url: '/uploads/img.jpg' } }
    );
    const { result, next } = runMiddleware(baseCtx);
    await result;
    expect(next).toHaveBeenCalled();
  });

  it('throws ValidationError when a required media field is empty', async () => {
    const { runMiddleware } = buildStrapi(
      { cover: { type: 'media', required: true } },
      { cover: null }
    );
    const { result } = runMiddleware(baseCtx);
    await expect(result).rejects.toThrow(errors.ValidationError);
    await expect(result).rejects.toThrow('Cover');
  });

  it('lists all missing fields in the error message', async () => {
    const { runMiddleware } = buildStrapi(
      {
        cover: { type: 'media', required: true },
        heroImage: { type: 'media', required: true },
      },
      { cover: null, heroImage: null }
    );
    const { result } = runMiddleware(baseCtx);
    await expect(result).rejects.toThrow('Cover');
    await expect(result).rejects.toThrow('Hero Image');
  });

  it('only validates required media fields, not optional ones', async () => {
    const { runMiddleware } = buildStrapi(
      {
        cover: { type: 'media', required: true },
        gallery: { type: 'media', required: false },
      },
      { cover: { id: 1 }, gallery: null }
    );
    const { result, next } = runMiddleware(baseCtx);
    await result;
    expect(next).toHaveBeenCalled();
  });

  it('populates only required media fields when fetching the document', async () => {
    const findOne = jest.fn().mockResolvedValue({ cover: { id: 1 } });
    const strapi = {
      documents: Object.assign(() => ({ findOne }), {
        use: jest.fn((fn: Function) => fn(baseCtx, jest.fn().mockResolvedValue(undefined))),
      }),
      getModel: jest.fn().mockReturnValue({
        attributes: {
          cover: { type: 'media', required: true },
          title: { type: 'string', required: true },
        },
      }),
    };

    plugin.register({ strapi: strapi as any });

    expect(findOne).toHaveBeenCalledWith({
      documentId: 'abc123',
      populate: { cover: true },
    });
  });
});
