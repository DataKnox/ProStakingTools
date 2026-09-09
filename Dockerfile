FROM node:20.18.0-alpine AS build

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000

COPY . .

ARG REACT_APP_RPC_ENDPOINT
ENV REACT_APP_RPC_ENDPOINT=${REACT_APP_RPC_ENDPOINT}
RUN yarn build

FROM nginx:1.30.2-alpine AS runtime

COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/security-headers.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
