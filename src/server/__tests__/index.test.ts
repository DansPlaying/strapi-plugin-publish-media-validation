import { errors } from '@strapi/utils';
import plugin from '../index';

const baseCtx = {
  action: 'publish',
  uid: 'api::article.article',
  params: { documentId: 'abc123' },
};

const ARTICLE_UID = 'api::article.article';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simple helper: getModel always returns the same model regardless of UID.
 * Use for flat content-type tests with no components or dynamic zones.
 */
function buildStrapi(
  modelAttributes: Record<string, unknown> | null,
  docFields: Record<string, unknown> | null = {}
) {
  let capturedMiddleware: Function | null = null;

  const strapi = {
    documents: Object.assign(
      (_uid: string) => ({
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
    runMiddleware: (ctx: Record<string, unknown> = baseCtx) => {
      if (!capturedMiddleware) throw new Error('middleware not registered');
      const next = jest.fn().mockResolvedValue(undefined);
      return { result: capturedMiddleware(ctx, next), next };
    },
  };
}

/**
 * Multi-model helper: getModel returns different attributes per UID.
 * Required for tests involving components or dynamic zones.
 */
function buildStrapiFromModels(
  modelsByUid: Record<string, Record<string, unknown>>,
  docFields: Record<string, unknown> | null = {}
) {
  let capturedMiddleware: Function | null = null;

  const strapi = {
    documents: Object.assign(
      (_uid: string) => ({
        findOne: jest.fn().mockResolvedValue(docFields),
      }),
      {
        use: jest.fn((fn: Function) => {
          capturedMiddleware = fn;
        }),
      }
    ),
    getModel: jest.fn((uid: string) => {
      const attrs = modelsByUid[uid];
      return attrs !== undefined ? { attributes: attrs } : null;
    }),
  };

  plugin.register({ strapi: strapi as any });

  return {
    strapi,
    runMiddleware: (ctx: Record<string, unknown> = baseCtx) => {
      if (!capturedMiddleware) throw new Error('middleware not registered');
      const next = jest.fn().mockResolvedValue(undefined);
      return { result: capturedMiddleware(ctx, next), next };
    },
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('register', () => {
  it('calls strapi.documents.use once', () => {
    const { strapi } = buildStrapi({});
    expect(strapi.documents.use).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Flat (top-level) media fields
// ---------------------------------------------------------------------------

describe('middleware — flat media fields', () => {
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

  it('passes through when model has no media fields at all', async () => {
    const { runMiddleware } = buildStrapi({
      title: { type: 'string', required: true },
    });
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

  it('builds populate that includes all media fields when fetching the document', async () => {
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

// ---------------------------------------------------------------------------
// Component fields
// ---------------------------------------------------------------------------

describe('middleware — component fields', () => {
  const HERO_UID = 'sections.hero';

  it('passes through when component required media is populated', async () => {
    const { runMiddleware } = buildStrapiFromModels(
      {
        [ARTICLE_UID]: { hero: { type: 'component', component: HERO_UID } },
        [HERO_UID]: { photo: { type: 'media', required: true } },
      },
      { hero: { photo: { id: 1 } } }
    );
    const { result, next } = runMiddleware();
    await result;
    expect(next).toHaveBeenCalled();
  });

  it('throws when component required media is empty', async () => {
    const { runMiddleware } = buildStrapiFromModels(
      {
        [ARTICLE_UID]: { hero: { type: 'component', component: HERO_UID } },
        [HERO_UID]: { photo: { type: 'media', required: true } },
      },
      { hero: { photo: null } }
    );
    const { result } = runMiddleware();
    await expect(result).rejects.toThrow(errors.ValidationError);
    await expect(result).rejects.toThrow('Hero > photo');
  });

  it('passes through when all repeatable component items have required media', async () => {
    const { runMiddleware } = buildStrapiFromModels(
      {
        [ARTICLE_UID]: { cards: { type: 'component', component: HERO_UID, repeatable: true } },
        [HERO_UID]: { photo: { type: 'media', required: true } },
      },
      { cards: [{ photo: { id: 1 } }, { photo: { id: 2 } }] }
    );
    const { result, next } = runMiddleware();
    await result;
    expect(next).toHaveBeenCalled();
  });

  it('reports the correct index for a missing repeatable component item', async () => {
    const { runMiddleware } = buildStrapiFromModels(
      {
        [ARTICLE_UID]: { cards: { type: 'component', component: HERO_UID, repeatable: true } },
        [HERO_UID]: { photo: { type: 'media', required: true } },
      },
      { cards: [{ photo: { id: 1 } }, { photo: null }] }
    );
    const { result } = runMiddleware();
    await expect(result).rejects.toThrow('Cards[2] > photo');
  });

  it('builds populate that includes the component media field', async () => {
    const findOne = jest.fn().mockResolvedValue({ hero: { photo: { id: 1 } } });
    let capturedMiddleware: Function | null = null;
    const strapi = {
      documents: Object.assign(() => ({ findOne }), {
        use: jest.fn((fn: Function) => {
          capturedMiddleware = fn;
        }),
      }),
      getModel: jest.fn((uid: string) => {
        if (uid === ARTICLE_UID) return { attributes: { hero: { type: 'component', component: HERO_UID } } };
        if (uid === HERO_UID)    return { attributes: { photo: { type: 'media', required: true } } };
        return null;
      }),
    };

    plugin.register({ strapi: strapi as any });
    await capturedMiddleware!(baseCtx, jest.fn().mockResolvedValue(undefined));

    expect(findOne).toHaveBeenCalledWith({
      documentId: 'abc123',
      populate: { hero: { populate: { photo: true } } },
    });
  });
});

// ---------------------------------------------------------------------------
// Dynamic zone fields
// ---------------------------------------------------------------------------

describe('middleware — dynamiczone fields', () => {
  const COPY_PHOTO_UID = 'sections.copy-photo';
  const TEXT_UID = 'sections.text';

  it('passes through when all blocks have required media populated', async () => {
    const { runMiddleware } = buildStrapiFromModels(
      {
        [ARTICLE_UID]: { blocks: { type: 'dynamiczone', components: [COPY_PHOTO_UID] } },
        [COPY_PHOTO_UID]: { photo: { type: 'media', required: true } },
      },
      { blocks: [{ __component: COPY_PHOTO_UID, photo: { id: 1 } }] }
    );
    const { result, next } = runMiddleware();
    await result;
    expect(next).toHaveBeenCalled();
  });

  it('throws when a block is missing required media', async () => {
    const { runMiddleware } = buildStrapiFromModels(
      {
        [ARTICLE_UID]: { blocks: { type: 'dynamiczone', components: [COPY_PHOTO_UID] } },
        [COPY_PHOTO_UID]: { photo: { type: 'media', required: true } },
      },
      { blocks: [{ __component: COPY_PHOTO_UID, photo: null }] }
    );
    const { result } = runMiddleware();
    await expect(result).rejects.toThrow(errors.ValidationError);
    await expect(result).rejects.toThrow('Blocks[1] > photo');
  });

  it('reports the correct block index in a multi-block dynamic zone', async () => {
    const { runMiddleware } = buildStrapiFromModels(
      {
        [ARTICLE_UID]: { blocks: { type: 'dynamiczone', components: [COPY_PHOTO_UID] } },
        [COPY_PHOTO_UID]: { photo: { type: 'media', required: true } },
      },
      {
        blocks: [
          { __component: COPY_PHOTO_UID, photo: { id: 1 } },
          { __component: COPY_PHOTO_UID, photo: null },
        ],
      }
    );
    const { result } = runMiddleware();
    await expect(result).rejects.toThrow('Blocks[2] > photo');
  });

  it('skips blocks whose component type has no required media', async () => {
    const { runMiddleware } = buildStrapiFromModels(
      {
        [ARTICLE_UID]: { blocks: { type: 'dynamiczone', components: [COPY_PHOTO_UID, TEXT_UID] } },
        [COPY_PHOTO_UID]: { photo: { type: 'media', required: true } },
        [TEXT_UID]: { content: { type: 'richtext' } },
      },
      {
        blocks: [
          { __component: TEXT_UID, content: 'hello' },
          { __component: COPY_PHOTO_UID, photo: { id: 1 } },
        ],
      }
    );
    const { result, next } = runMiddleware();
    await result;
    expect(next).toHaveBeenCalled();
  });

  it('throws only for the failing block in a mixed dynamic zone', async () => {
    const { runMiddleware } = buildStrapiFromModels(
      {
        [ARTICLE_UID]: { blocks: { type: 'dynamiczone', components: [COPY_PHOTO_UID, TEXT_UID] } },
        [COPY_PHOTO_UID]: { photo: { type: 'media', required: true } },
        [TEXT_UID]: { content: { type: 'richtext' } },
      },
      {
        blocks: [
          { __component: TEXT_UID, content: 'hello' },
          { __component: COPY_PHOTO_UID, photo: null },
        ],
      }
    );
    const { result } = runMiddleware();
    await expect(result).rejects.toThrow('Blocks[2] > photo');
  });

  it('builds populate that merges media fields from all component types', async () => {
    const findOne = jest.fn().mockResolvedValue({
      blocks: [{ __component: COPY_PHOTO_UID, photo: { id: 1 } }],
    });
    let capturedMiddleware: Function | null = null;
    const strapi = {
      documents: Object.assign(() => ({ findOne }), {
        use: jest.fn((fn: Function) => {
          capturedMiddleware = fn;
        }),
      }),
      getModel: jest.fn((uid: string) => {
        if (uid === ARTICLE_UID)    return { attributes: { blocks: { type: 'dynamiczone', components: [COPY_PHOTO_UID, TEXT_UID] } } };
        if (uid === COPY_PHOTO_UID) return { attributes: { photo: { type: 'media', required: true } } };
        if (uid === TEXT_UID)       return { attributes: { content: { type: 'richtext' } } };
        return null;
      }),
    };

    plugin.register({ strapi: strapi as any });
    await capturedMiddleware!(baseCtx, jest.fn().mockResolvedValue(undefined));

    expect(findOne).toHaveBeenCalledWith({
      documentId: 'abc123',
      populate: { blocks: { populate: { photo: true } } },
    });
  });
});
