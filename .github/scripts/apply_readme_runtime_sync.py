from pathlib import Path

path = Path('README.md')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'expected one match, found {count}: {old[:120]!r}')
    text = text.replace(old, new, 1)

replace_once(
    '- 客服在线心跳；',
    '- WebSocket 长连接心跳维护客服在线状态，网络恢复时使用 REST heartbeat 对账；',
)
replace_once(
    '- 最少进行中会话优先分流；',
    '- 分区 / 分类 / 指定产品动态负责范围，最少进行中会话优先分流；',
)
replace_once(
    """## 客服在线与分流

客服登录成功后状态变为在线，坐席端每 30 秒发送一次心跳。

分流只选择：

```text
账号已启用
属于目标客服分组
分组已启用
客服状态为 online
最近 2 分钟内有有效心跳
未超过最大同时会话数
```

排序策略：

```text
进行中会话最少
→ 分组成员优先级
→ 最久未分配
→ 客服 ID
```

如果访客发起会话时目标分组没有在线客服，会话保持未分配；当符合条件的客服登录或发送心跳时，会重新尝试分流。
""",
    """## 客服在线与分流

客服登录成功后状态变为在线。坐席工作台以 WebSocket 为主通道，连接建立和 ping/pong 会维护 `last_seen_at`；不再通过固定 30 秒 HTTP 轮询维持在线。浏览器从离线、休眠或断线状态恢复时，会执行一次 REST heartbeat + 状态对账。

负责范围按规则保存，不展开成大量产品 ID：

```text
整个分区
→ 动态覆盖该分区当前及未来新增产品

指定分类
→ 动态覆盖分区内选中的分类

指定产品
→ 只覆盖明确选择的产品
```

分流优先使用上述 `agent_routing_scopes`。只有没有任何分区 / 分类 / 产品范围命中时，才使用旧客服分组成员关系作为兼容回退。

候选客服必须满足：

```text
账号已启用
账号可登录
客服状态为 online
最近 2 分钟内有有效在线记录
负责范围命中当前产品（或进入兼容分组回退）
未超过最大同时会话数
```

排序策略：

```text
进行中会话最少
→ 最久未分配
→ 客服 ID
```

候选选择、容量判断和会话写入在同一个 SQLite CTE + UPDATE 中完成，避免并发会话基于过期容量快照重复压给同一客服。

如果访客发起会话时没有符合条件的客服，会话保持未分配；客服登录、恢复 heartbeat，或已有会话关闭释放容量时，会重新尝试分流。
""",
)
replace_once(
    """sites
support_groups
agents
group_agents
agent_sessions
visitors
conversations
messages""",
    """sites
support_groups
group_agents
agents
agent_routing_scopes
agent_sessions
product_catalog
visitors
conversations
messages""",
)
replace_once(
    """support_groups
  └─ group_agents
       └─ agents
            └─ agent_sessions

conversations
  ├─ group_id
  └─ assigned_agent""",
    """agents
  ├─ agent_routing_scopes
  │    ├─ section
  │    ├─ category
  │    └─ product
  └─ agent_sessions

product_catalog
  └─ 为分流保存产品 / 分区 / 分类上下文

support_groups
  └─ group_agents
       └─ 仅作为未命中 scope 时的兼容回退

conversations
  ├─ product_id / section_id / category_id
  ├─ group_id
  └─ assigned_agent""",
)
replace_once(
    """POST /api/agent/auth/heartbeat

GET  /api/agent/overview""",
    """POST /api/agent/auth/heartbeat   # 恢复/兼容对账，不是固定周期轮询

GET  /api/agent/overview""",
)
replace_once(
    """按客服分组进行自动分流
实时消息与长期数据分离""",
    """按分区 / 分类 / 产品动态范围自动分流
客服分组仅保留兼容回退
实时消息与长期数据分离""",
)

path.write_text(text, encoding='utf-8')
print('README synchronized with current runtime architecture.')
