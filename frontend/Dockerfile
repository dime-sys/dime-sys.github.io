# build
FROM node:20 AS build

WORKDIR /app
COPY frontend/ .

RUN npm install
RUN npm run build

# serve con nginx
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80