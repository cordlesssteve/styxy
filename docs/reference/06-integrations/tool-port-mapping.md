# Development Tool Port Mapping

**Status**: ACTIVE
**Last Updated**: 2025-09-19
**Purpose**: Comprehensive mapping of development tools to CORE service types for Styxy integration

## Tool-to-Service-Type Mapping

### Frontend Development Tools → `dev` (3000-3099)
- **React**: `npm start`, `yarn start`, `react-scripts start`
- **Next.js**: `next dev`, `npm run dev`, `yarn dev`
- **Vite**: `vite`, `vite dev`, `npm run dev`
- **Angular**: `ng serve`, `npm start`
- **Vue**: `vue-cli-service serve`, `npm run serve`
- **Nuxt.js**: `nuxt dev`, `npm run dev`
- **Svelte**: `npm run dev`, `yarn dev`
- **Parcel**: `parcel`, `npm start`
- **Webpack Dev Server**: `webpack serve`, `webpack-dev-server`

### API/Backend Services → `api` (8000-8099)
- **Express**: `node server.js`, `npm run server`
- **FastAPI**: `uvicorn main:app`, `fastapi dev`
- **Django**: `python manage.py runserver`
- **Flask**: `flask run`, `python app.py`
- **NestJS**: `npm run start:dev`, `nest start`
- **Koa**: `node app.js`
- **Hapi**: `node server.js`
- **Deno**: `deno run --allow-net server.ts`

### Database Services → `database` (8080-8099)
- **Firebase Emulator**: `firebase emulators:start`
- **MongoDB**: `mongod --port`
- **PostgreSQL**: `postgres -p`
- **MySQL**: `mysqld --port`
- **Redis**: `redis-server --port`
- **CouchDB**: `couchdb -p`
- **InfluxDB**: `influxd --http-bind-address`

### Authentication Services → `auth` (9099-9199)
- **Firebase Auth Emulator**: `firebase emulators:start --only auth`
- **Auth0**: Custom auth servers
- **Keycloak**: `keycloak start`
- **OAuth2 Proxy**: `oauth2-proxy`
- **Supabase**: `supabase start`

### Serverless Functions → `functions` (5000-5099)
- **Firebase Functions**: `firebase emulators:start --only functions`
- **Vercel Dev**: `vercel dev`
- **Netlify Dev**: `netlify dev`
- **AWS SAM**: `sam local start-api`
- **Serverless Framework**: `serverless offline`

### UI/Admin Interfaces → `ui` (4000-4099)
- **Firebase Emulator UI**: `firebase emulators:start`
- **Retool**: Custom admin interfaces
- **Grafana**: `grafana-server`
- **Adminer**: `php -S localhost:4000`
- **PHPMyAdmin**: Web interfaces

### Coordination Hubs → `hub` (4400-4499)
- **Firebase Emulator Hub**: Multi-service coordination
- **Docker Compose**: Service orchestration
- **Kubernetes Dashboard**: `kubectl proxy`
- **Traefik**: `traefik --api`

### Component Development → `storybook` (6006-6029)
- **Storybook**: `storybook dev`, `npm run storybook`
- **Bit**: `bit start`
- **Styleguidist**: `styleguidist server`
- **Docusaurus**: Component documentation

### Testing Tools → `test` (9200-9299)
- **Cypress**: `cypress open`, `cypress run`
- **Playwright**: `playwright test --ui`
- **Selenium**: WebDriver servers
- **Jest**: `jest --watchAll`
- **Vitest**: `vitest --ui`
- **Karma**: `karma start`
- **Puppeteer**: Browser automation

### Development Proxies → `proxy` (8100-8199)
- **Webpack Dev Server**: Proxy mode
- **Vite Proxy**: Development proxy
- **http-proxy-middleware**: `proxy-server`
- **Local Tunnel**: `lt --port`
- **ngrok**: `ngrok http`
- **BrowserSync**: `browser-sync start`

### Documentation Servers → `docs` (4100-4199)
- **Docusaurus**: `docusaurus start`
- **GitBook**: `gitbook serve`
- **MkDocs**: `mkdocs serve`
- **Sphinx**: `sphinx-build`
- **VuePress**: `vuepress dev`
- **Jekyll**: `jekyll serve`

### Monitoring/Metrics → `monitoring` (3100-3199)
- **Prometheus**: `prometheus --web.listen-address`
- **Grafana**: `grafana-server --port`
- **Jaeger**: `jaeger-all-in-one`
- **New Relic**: Local agents
- **DataDog**: Local agents

### Build Tools → `build` (8200-8299)
- **Webpack**: Build servers
- **Rollup**: `rollup -w`
- **Parcel**: Build watch mode
- **ESBuild**: `esbuild --serve`
- **Turbo**: `turbo dev`

## Port Parameter Patterns

### Common Port Flags
- `--port <number>`
- `-p <number>`
- `--listen-port <number>`
- `--server-port <number>`
- `--dev-port <number>`
- `--host-port <number>`

### Environment Variables
- `PORT=<number>`
- `DEV_PORT=<number>`
- `SERVER_PORT=<number>`
- `VITE_PORT=<number>`
- `NEXT_PORT=<number>`

### Configuration Files
- `package.json` scripts with port arguments
- `vite.config.js` server.port
- `next.config.js` server configuration
- `webpack.config.js` devServer.port

## Command Pattern Examples

### Development Servers
```bash
# React
npm start                           # Usually port 3000
npm start -- --port 3001          # Custom port
REACT_APP_PORT=3001 npm start      # Environment variable

# Next.js
next dev                           # Port 3000
next dev -p 3001                   # Custom port
PORT=3001 next dev                 # Environment variable

# Vite
vite                               # Port 5173
vite --port 3000                   # Custom port
vite dev --port 3000               # Dev mode with port

# Angular
ng serve                           # Port 4200
ng serve --port 3000               # Custom port

# Vue
npm run serve                      # Port 8080
npm run serve -- --port 3000      # Custom port
```

### Backend Services
```bash
# Express/Node
node server.js                     # Variable port
PORT=8000 node server.js          # Environment variable

# FastAPI
uvicorn main:app                   # Port 8000
uvicorn main:app --port 8001       # Custom port

# Django
python manage.py runserver         # Port 8000
python manage.py runserver 8001    # Custom port
```

### Testing Tools
```bash
# Cypress
cypress open                       # Random port
cypress open --port 9200          # Custom port

# Playwright
playwright test --ui               # Random port
playwright test --ui --port 9201   # Custom port
```

## Integration Priority

### High Priority (Common in Claude Code workflows)
1. **React/Next.js/Vite** - Frontend development
2. **Cypress/Playwright** - E2E testing
3. **Storybook** - Component development
4. **Express/FastAPI** - API development
5. **Firebase Emulators** - Full-stack development

### Medium Priority (Frequent use)
1. **Webpack Dev Server** - Build tools
2. **Jest/Vitest** - Testing frameworks
3. **Docker/Docker Compose** - Containerization
4. **Prometheus/Grafana** - Monitoring

### Lower Priority (Specialized use)
1. **Jekyll/MkDocs** - Documentation
2. **Redis/MongoDB** - Database development
3. **OAuth/Auth services** - Authentication development

## Implementation Strategy

### Phase 1: Core Development Tools
- React, Next.js, Vite, Angular, Vue
- Express, FastAPI, Django
- Cypress, Playwright, Storybook

### Phase 2: Build and Testing
- Webpack, Rollup, Parcel
- Jest, Vitest, Karma
- Firebase Emulators

### Phase 3: Infrastructure
- Docker, Kubernetes
- Prometheus, Grafana
- Documentation tools

### Phase 4: Specialized Tools
- Database servers
- Authentication services
- Proxy and tunnel tools