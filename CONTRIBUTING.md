# Contributing to mcp-api-reference

## Adding a New Preset

### Step 1: Create the config file
`src/presets/{api-name}/config.ts`
- Define `PresetConfig` with id, name, baseUrl, crawl settings

### Step 2: Implement the parser
`src/presets/{api-name}/parser.ts`
- Implement `SiteParser` interface
- Use cheerio to parse HTML from the API docs site

### Step 3: Create HTML fixtures
`tests/fixtures/{api-name}/`
- Capture representative HTML pages from the API docs
- Include both an endpoint page and a non-endpoint page

### Step 4: Write unit tests
`tests/unit/presets/{api-name}.test.ts`
- Test `parseEndpoint()` with HTML fixtures
- Cover: normal endpoint, empty page, parameter extraction, response fields

### Step 5: Register the preset
`src/presets/index.ts`
- Import and register in `createRegistryWithPresets()`

## Test Guidelines
- All tests must PASS with SKIP=0
- Use HTML fixtures (never mock `cheerio`)
- Run: `npm test` before submitting PR
- Run: `npx tsc --noEmit` to check types

## Development Setup
```bash
npm install
npm run build
npm test
```
