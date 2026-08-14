import fs from 'node:fs';

const path = 'src/dashboard/App.tsx';
let source = fs.readFileSync(path, 'utf8');

source = source.replace(
  "} from './api';\n",
  "} from './api';\nimport { getAgentMedia, sendAgentImage, type AgentMediaItem } from './agent-media';\n",
);

source = source.replace(
  "  const [detail, setDetail] = useState<ConversationDetail | null>(null);\n  const [draft, setDraft] = useState('');\n",
  "  const [detail, setDetail] = useState<ConversationDetail | null>(null);\n  const [mediaItems, setMediaItems] = useState<AgentMediaItem[]>([]);\n  const [mediaProgress, setMediaProgress] = useState<number | null>(null);\n  const [draft, setDraft] = useState('');\n",
);

source = source.replace(
  `    if (!selectedId) {\n      setDetail(null);\n      return;\n    }\n    let active = true;\n    const load = () =>\n      getConversation(selectedId)\n        .then((value) => {\n          if (active) setDetail(value);\n        })\n        .catch((reason) => {\n          if (active) setError(message(reason, '无法加载会话'));\n        });`,
  `    if (!selectedId) {\n      setDetail(null);\n      setMediaItems([]);\n      return;\n    }\n    let active = true;\n    const load = () =>\n      Promise.all([getConversation(selectedId), getAgentMedia(selectedId)])\n        .then(([value, media]) => {\n          if (active) {\n            setDetail(value);\n            setMediaItems(media);\n          }\n        })\n        .catch((reason) => {\n          if (active) setError(message(reason, '无法加载会话'));\n        });`,
);

source = source.replace(
  "  async function changeStatus(status: Conversation['status']) {\n",
  `  async function submitImage(file: File) {\n    if (!selectedId) return;\n    setMediaProgress(0);\n    try {\n      await sendAgentImage(selectedId, file, setMediaProgress);\n      const [nextDetail, nextMedia] = await Promise.all([\n        getConversation(selectedId),\n        getAgentMedia(selectedId),\n      ]);\n      setDetail(nextDetail);\n      setMediaItems(nextMedia);\n      await refresh();\n    } catch (reason) {\n      setError(message(reason, '图片发送失败'));\n    } finally {\n      setMediaProgress(null);\n    }\n  }\n\n  async function changeStatus(status: Conversation['status']) {\n`,
);

source = source.replace(
  `                <Bubble\n                  key={item.id}\n                  message={item}\n                  currentAgentId={identity.id}\n                />`,
  `                <Bubble\n                  key={item.id}\n                  message={item}\n                  currentAgentId={identity.id}\n                  media={mediaItems.find((media) => media.messageId === item.id) ?? null}\n                />`,
);

source = source.replace(
  `            <form className="composer" onSubmit={(event) => void submit(event)}>\n              <textarea`,
  `            <form className="composer" onSubmit={(event) => void submit(event)}>\n              <label className="media-picker" aria-label="发送图片">\n                ＋\n                <input\n                  type="file"\n                  accept="image/jpeg,image/png,image/webp,image/gif"\n                  disabled={detail.conversation.status === 'closed' || mediaProgress !== null}\n                  onChange={(event) => {\n                    const file = event.target.files?.[0];\n                    event.currentTarget.value = '';\n                    if (file) void submitImage(file);\n                  }}\n                />\n              </label>\n              <textarea`,
);

source = source.replace(
  `              <div className="composer-foot">\n                <span>Enter 发送 · Shift + Enter 换行</span>`,
  `              <div className="composer-foot">\n                <span className="media-upload-progress">\n                  {mediaProgress === null ? 'Enter 发送 · Shift + Enter 换行' : \`图片上传 ${Math.round(mediaProgress * 100)}%\`}\n                </span>`,
);

source = source.replace(
  `function Bubble({\n  message: item,\n}: {\n  message: Message;\n  currentAgentId: string;\n}) {`,
  `function Bubble({\n  message: item,\n  media,\n}: {\n  message: Message;\n  currentAgentId: string;\n  media: AgentMediaItem | null;\n}) {`,
);

source = source.replace(
  `  return (\n    <div className={isAgent ? 'message mine' : 'message visitor'}>\n      {!isAgent && <span className="avatar tiny">访</span>}\n      <div>\n        <p>{item.body}</p>\n        <time>{formatTime(item.created_at)}</time>\n      </div>\n    </div>\n  );`,
  `  return (\n    <div className={isAgent ? 'message mine' : 'message visitor'}>\n      {!isAgent && <span className="avatar tiny">访</span>}\n      <div>\n        {media ? (\n          <a href={media.url} target="_blank" rel="noreferrer">\n            <img className="message-image" src={media.url} alt="聊天图片" loading="lazy" />\n          </a>\n        ) : (\n          <p>{item.body}</p>\n        )}\n        <time>{formatTime(item.created_at)}</time>\n      </div>\n    </div>\n  );`,
);

fs.writeFileSync(path, source);
