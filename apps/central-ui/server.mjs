import express from "express";
import { createRequestHandler } from "@react-router/express";
import { stampSourceIp } from "./source-ip.mjs";

const app = express();
app.disable("x-powered-by");
app.use((request, _response, next) => {
  stampSourceIp(request);
  next();
});
app.use(express.static("build/client"));
app.use(
  createRequestHandler({ build: await import("./build/server/index.js") }),
);
app.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? "0.0.0.0");
