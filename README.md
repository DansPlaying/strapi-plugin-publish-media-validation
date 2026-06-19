# strapi-plugin-publish-media-validation

A Strapi v5 plugin that enforces `required: true` on **media fields at publish time**.

## Why this exists

Strapi v5 validates `required: true` on scalar fields (string, integer, etc.) when publishing, but skips that check for media fields (`type: "media"`). This means a content manager can publish an entry with a missing required banner, thumbnail, or any other required image/file — even though the field is marked as required in the schema.

This plugin intercepts the Document Service `publish` action and blocks it if any required media field is empty, returning a clear error message instead of silently allowing the publish.

## Installation

```bash
npm install strapi-plugin-publish-media-validation
# or
yarn add strapi-plugin-publish-media-validation
# or
pnpm add strapi-plugin-publish-media-validation
```

### pnpm users

Because `@strapi/utils` is a peer dependency and pnpm does not hoist packages by default, you also need to add it as a direct dependency:

```bash
pnpm add @strapi/utils
```

## Usage

No configuration needed. Once installed, the plugin automatically scans every content type's schema on publish and blocks any entry where a `required: true` media field is empty.

**Example schema:**

```json
{
  "banner": {
    "type": "media",
    "multiple": false,
    "required": true,
    "allowedTypes": ["images"]
  }
}
```

If you try to publish without a banner, the admin panel will show:

> The following required media fields are empty: Banner

## How it works

The plugin registers a [Document Service middleware](https://docs.strapi.io/dev-docs/backend-customization/document-service-middlewares) that:

1. Runs on every `publish` action across all content types
2. Reads the model schema to find `type: "media"` fields with `required: true`
3. Fetches the draft document and checks each required media field
4. Throws a `ValidationError` listing any empty fields, which Strapi maps to a 400 response with the message shown in the admin UI

## Compatibility

| Strapi version | Supported |
|----------------|-----------|
| v5.x           | ✅        |
| v4.x           | ❌        |
