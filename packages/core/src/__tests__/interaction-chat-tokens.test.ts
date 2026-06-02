import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInteractionToolsFromDeps } from "../interaction/project-tools.js";

const mockChatCompletion = vi.hoisted(() => vi.fn());
const mockChatWithTools = vi.hoisted(() => vi.fn());

vi.mock("../index.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, chatCompletion: mockChatCompletion, chatWithTools: mockChatWithTools };
});

const fakePipeline = {
  config: {
    client: {} as object,
    model: "gpt-4o",
  },
  writeNextChapter: vi.fn(),
  reviseDraft: vi.fn(),
};

const fakeState = {
  ensureControlDocuments: vi.fn(async () => {}),
  bookDir: vi.fn(() => "/tmp/books/test"),
  loadBookConfig: vi.fn(async () => undefined),
  loadChapterIndex: vi.fn(async () => []),
  saveChapterIndex: vi.fn(async () => undefined),
  listBooks: vi.fn(async () => []),
};

const MOCK_CHAT_RESPONSE = {
  content: [
    "好的，你想写都市异能，请问主角是什么类型的能力？",
    "",
    ':::field{key="title" label="书名"}',
    "都市异能",
    ":::",
  ].join("\n"),
  tokensUsed: { prompt: 5, completion: 80, total: 85 },
};

const MOCK_TOOL_RESPONSE = {
  content: "好的，已根据你的描述生成建书参数。",
  toolCalls: [
    {
      id: "call_1",
      name: "create_book",
      arguments: JSON.stringify({
        title: "都市异能",
        genre: "urban",
        platform: "tomato",
        targetChapters: 160,
        chapterWordCount: 2800,
        brief: "都市异能题材",
        worldPremise: "旧城区被异能公司分区管理，普通人靠通行证活着。",
        protagonist: "陈野，外卖员，能看见别人欠下的代价。",
        conflictCore: "主角想保住妹妹，却被公司逼成黑市清账人。",
        volumeOutline: "卷一先查妹妹病历，再掀出公司清账规则。",
        nextQuestion: "主角的异能代价要不要更重？",
        missingFields: ["supportingCast"],
        readyToCreate: false,
      }),
    },
  ],
};

describe("chat tool – maxTokens forwarding", () => {
  beforeEach(() => {
    mockChatCompletion.mockResolvedValue({
      content: "Hello",
      tokensUsed: { prompt: 5, completion: 10, total: 15 },
    });
    mockChatCompletion.mockClear();
  });

  it("does not pass maxTokens to chatCompletion when depth has no maxTokens set", async () => {
    const tools = createInteractionToolsFromDeps(
      fakePipeline as never,
      fakeState as never,
      {
        getChatRequestOptions: () => ({ temperature: 0.7 }),
      },
    );

    await tools.chat?.("你好", { bookId: "test-book", automationMode: "manual" });

    expect(mockChatCompletion).toHaveBeenCalledOnce();
    const options = mockChatCompletion.mock.calls[0]?.[3] as Record<string, unknown> | undefined;
    expect(options).not.toHaveProperty("maxTokens");
  });

  it("passes maxTokens to chatCompletion when depth explicitly sets it", async () => {
    const tools = createInteractionToolsFromDeps(
      fakePipeline as never,
      fakeState as never,
      {
        getChatRequestOptions: () => ({ temperature: 0.7, maxTokens: 512 }),
      },
    );

    await tools.chat?.("你好", { bookId: "test-book", automationMode: "manual" });

    expect(mockChatCompletion).toHaveBeenCalledOnce();
    const options = mockChatCompletion.mock.calls[0]?.[3] as Record<string, unknown> | undefined;
    expect(options).toHaveProperty("maxTokens", 512);
  });

  it("rethrows real chatCompletion errors instead of silently falling back", async () => {
    mockChatCompletion.mockRejectedValueOnce(new Error("provider down"));

    const tools = createInteractionToolsFromDeps(
      fakePipeline as never,
      fakeState as never,
      {
        getChatRequestOptions: () => ({ temperature: 0.7 }),
      },
    );

    await expect(
      tools.chat?.("你好", { bookId: "test-book", automationMode: "manual" }),
    ).rejects.toThrow("provider down");
  });
});

describe("developBookDraft – uses chatWithTools", () => {
  beforeEach(() => {
    mockChatWithTools.mockResolvedValue(MOCK_TOOL_RESPONSE);
    mockChatWithTools.mockClear();
  });

  it("calls chatWithTools with create_book tool and does not pass maxTokens", async () => {
    const tools = createInteractionToolsFromDeps(
      fakePipeline as never,
      fakeState as never,
    );

    await tools.developBookDraft?.("我想写都市异能", undefined);

    expect(mockChatWithTools).toHaveBeenCalledOnce();
    const options = mockChatWithTools.mock.calls[0]?.[4] as Record<string, unknown> | undefined;
    expect(options).not.toHaveProperty("maxTokens");
  });

  it("extracts tool call arguments into the creation draft", async () => {
    const tools = createInteractionToolsFromDeps(
      fakePipeline as never,
      fakeState as never,
    );

    const result = await tools.developBookDraft?.("我想写都市异能", undefined) as Record<string, unknown>;
    const interaction = (result as { __interaction: Record<string, unknown> }).__interaction;
    const details = interaction.details as Record<string, unknown>;

    expect(details.creationDraft).toEqual(expect.objectContaining({
      title: "都市异能",
      genre: "urban",
      platform: "tomato",
      targetChapters: 160,
      chapterWordCount: 2800,
      blurb: "都市异能题材",
      worldPremise: "旧城区被异能公司分区管理，普通人靠通行证活着。",
      protagonist: "陈野，外卖员，能看见别人欠下的代价。",
      conflictCore: "主角想保住妹妹，却被公司逼成黑市清账人。",
      volumeOutline: "卷一先查妹妹病历，再掀出公司清账规则。",
      nextQuestion: "主角的异能代价要不要更重？",
      missingFields: ["supportingCast"],
      readyToCreate: false,
    }));
    expect(details.toolCall).toEqual({
      name: "create_book",
      arguments: {
        title: "都市异能",
        genre: "urban",
        platform: "tomato",
        targetChapters: 160,
        chapterWordCount: 2800,
        brief: "都市异能题材",
        worldPremise: "旧城区被异能公司分区管理，普通人靠通行证活着。",
        protagonist: "陈野，外卖员，能看见别人欠下的代价。",
        conflictCore: "主角想保住妹妹，却被公司逼成黑市清账人。",
        volumeOutline: "卷一先查妹妹病历，再掀出公司清账规则。",
        nextQuestion: "主角的异能代价要不要更重？",
        missingFields: ["supportingCast"],
        readyToCreate: false,
      },
    });
  });

  it("fills editable length defaults and never blocks creation on missing length", async () => {
    // The LLM returns the six story-core fields but no length — length is a run
    // parameter, so the draft should default to 200/3000 and still be ready.
    mockChatWithTools.mockResolvedValueOnce({
      content: "已生成草案。",
      toolCalls: [
        {
          id: "call_2",
          name: "create_book",
          arguments: JSON.stringify({
            title: "夜港账本",
            genre: "urban",
            platform: "tomato",
            worldPremise: "近未来港口城，账本牵出多方势力。",
            protagonist: "林砚，水货账房出身。",
            conflictCore: "洗白与旧债回潮的对撞。",
            readyToCreate: true,
          }),
        },
      ],
    });

    const tools = createInteractionToolsFromDeps(fakePipeline as never, fakeState as never);
    const result = await tools.developBookDraft?.("我想写港风商战", undefined) as Record<string, unknown>;
    const details = (result as { __interaction: { details: Record<string, unknown> } }).__interaction.details;
    const draft = details.creationDraft as Record<string, unknown>;

    expect(draft.targetChapters).toBe(200);
    expect(draft.chapterWordCount).toBe(3000);
    expect(draft.readyToCreate).toBe(true);
    expect(draft.missingFields).not.toContain("targetChapters");
    expect(draft.missingFields).not.toContain("chapterWordCount");
  });

  it("keeps a draft NOT ready while a story-core field (worldPremise) is missing, even with length defaulted", async () => {
    mockChatWithTools.mockResolvedValueOnce({
      content: "还差世界观。",
      toolCalls: [
        {
          id: "call_3",
          name: "create_book",
          arguments: JSON.stringify({
            title: "夜港账本",
            genre: "urban",
            platform: "tomato",
            protagonist: "林砚。",
            conflictCore: "洗白与旧债回潮的对撞。",
            readyToCreate: true, // LLM over-claims; deterministic gate must override
          }),
        },
      ],
    });

    const tools = createInteractionToolsFromDeps(fakePipeline as never, fakeState as never);
    const result = await tools.developBookDraft?.("我想写港风商战", undefined) as Record<string, unknown>;
    const details = (result as { __interaction: { details: Record<string, unknown> } }).__interaction.details;
    const draft = details.creationDraft as Record<string, unknown>;

    expect(draft.targetChapters).toBe(200);
    expect(draft.readyToCreate).toBe(false);
    expect(draft.missingFields).toContain("worldPremise");
  });

  it("returns fallback when no LLM is configured", async () => {
    const noLlmPipeline = {
      config: {},
      writeNextChapter: vi.fn(),
      reviseDraft: vi.fn(),
    };

    const tools = createInteractionToolsFromDeps(
      noLlmPipeline as never,
      fakeState as never,
    );

    const result = await tools.developBookDraft?.("我想写都市异能", undefined) as Record<string, unknown>;
    const interaction = (result as { __interaction: Record<string, unknown> }).__interaction;

    expect(mockChatWithTools).not.toHaveBeenCalled();
    expect(interaction.responseText).toContain("请先配置 LLM 模型");
  });
});
