import { MoodleSession } from "../../src/application/MoodleSession.ts";
import { SessionCookie } from "../../src/application/SessionCookie.ts";
import { es } from "../../src/i18n/es.ts";
import type { MoodleProfile } from "../../src/platforms/moodle/MoodleProfile.ts";
import { BASE } from "../fixtures/moodle.ts";
import { FakeHttpClient } from "./fakes.ts";
import { makeRecorder } from "./tracing.ts";

export const profile: MoodleProfile = {
  id: "org.test",
  baseUrl: new URL(BASE),
  contentsPaths: ["course/view.php?id={courseId}"],
  maxFileBytes: 1_000_000,
};

/** Sesión real sobre un cliente HTTP falso y un trazador real, para comprobar qué se registra. */
export function makeStack(http: FakeHttpClient = new FakeHttpClient(), options: { capture?: boolean } = {}) {
  const recorder = makeRecorder(options);
  const session = new MoodleSession({
    http,
    cookie: SessionCookie.parse("MoodleSession=cookie-value-123", es),
    baseUrl: profile.baseUrl,
    messages: es,
    tracer: recorder.tracer,
  });
  return { http, session, ...recorder };
}

export async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("se esperaba un rechazo");
}
