# The SPA is static once built, so the runtime image contains no Node at all —
# just nginx and a folder of files. Smaller image, smaller attack surface, and
# nothing to patch when the next Node CVE lands.
#
# Built from the repository root: docker build -f apps/ui/Dockerfile .

# glibc rather than Alpine for the builder. Rollup ships its native binary as
# separate glibc and musl packages, and every extra libc variant is another
# platform binary the lockfile has to carry (see optionalDependencies in the
# root package.json). The final image is nginx, so the builder's base costs
# nothing in the artefact that ships.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/ui/package.json ./apps/ui/
RUN npm ci
COPY apps/ui ./apps/ui
RUN npm run build --workspace @weather/ui

FROM nginx:1.27-alpine AS runtime
COPY apps/ui/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/ui/dist /usr/share/nginx/html
EXPOSE 80
