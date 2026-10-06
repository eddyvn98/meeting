import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { encodeMock, findUniqueMock } = vi.hoisted(() => ({
  encodeMock: vi.fn(),
  findUniqueMock: vi.fn(),
}));

vi.mock("next-auth/jwt", () => ({
  encode: encodeMock,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    meetingBotSession: {
      findUnique: findUniqueMock,
    },
  },
}));

import { POST } from "../../app/api/meeting/bot-sessions/stt-token/route";

const TOKEN_TTL_SEC = 6 * 60 * 60;

function request() {
  return new NextRequest("https://meeting.example/api/meeting/bot-sessions/stt-token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-meeting-bot-token": "runner-secret",
      "x-meeting-bot-runner-id": "runner-a",
    },
    body: JSON.stringify({ sessionId: "session-a" }),
  });
}

describe("meeting bot recorder token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MEETING_BOT_RUNNER_TOKEN = "runner-secret";
    process.env.NEXTAUTH_SECRET = "nextauth-secret";
    findUniqueMock.mockResolvedValue({
      id: "session-a",
      ownerEmail: "Owner@Example.com",
      runnerId: "runner-a",
      status: "CAPTURING",
    });
    encodeMock.mockResolvedValue("encoded-token");
  });

  afterEach(() => {
    delete process.env.MEETING_BOT_RUNNER_TOKEN;
    delete process.env.NEXTAUTH_SECRET;
  });

  it("keeps recorder JWT lifetime bounded to six hours", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(encodeMock).toHaveBeenCalledTimes(1);

    const options = encodeMock.mock.calls[0]?.[0];
    expect(options).toBeDefined();
    expect(options.maxAge).toBe(TOKEN_TTL_SEC);
    expect(options.secret).toBe("nextauth-secret");
    expect(options.token.meetingBotSessionId).toBe("session-a");
    expect(options.token.email).toBe("owner@example.com");
    expect(options.token.exp - options.token.iat).toBe(TOKEN_TTL_SEC);

    const body = await response.json();
    expect(body.token).toBe("encoded-token");
    expect(Date.parse(body.expiresAt) / 1000 - options.token.iat).toBe(TOKEN_TTL_SEC);
  });
});
