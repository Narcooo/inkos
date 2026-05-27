# 书籍详情页面去 AI 味按钮使用说明

## 🎯 功能位置

在书籍详情页面的章节列表中，每个章节的操作栏都新增了一个"去 AI 味"按钮。

## 🎨 按钮样式

- **图标**: ✨ (Sparkles)
- **颜色**: 紫色主题
  - 默认：紫色背景 + 紫色文字
  - 悬停：深紫色背景 + 白色文字
  - 加载中：紫色旋转动画
- **位置**: 章节操作栏最右侧（修订下拉菜单之前）

## 🚀 使用方法

### 1. 单章去 AI 味

1. 打开任意书籍的详情页
2. 找到想要处理的章节
3. 鼠标悬停在章节行上，操作栏会显示
4. 点击 ✨ "去 AI 味" 按钮
5. 系统会自动处理该章节

### 2. 处理流程

```
点击按钮
    ↓
显示加载动画（紫色旋转圈）
    ↓
调用 API: POST /books/:id/humanize/:chapter
    ↓
AITasteRemoverAgent 执行
├─ 门检（真人写作？停手）
├─ 语体识别
├─ AI 腔检测
├─ 保守修改
└─ 保存结果
    ↓
页面自动刷新
    ↓
显示修改后的章节
```

## 🔧 技术实现

### 按钮代码

```tsx
<button
  onClick={() => handleHumanize(ch.number)}
  disabled={humanizingChapters.includes(ch.number)}
  className="p-2 rounded-lg bg-purple-500/10 text-purple-600 hover:bg-purple-500 hover:text-white transition-all shadow-sm disabled:opacity-50"
  title="去 AI 味"
>
  {humanizingChapters.includes(ch.number)
    ? <div className="w-3.5 h-3.5 border-2 border-purple-600/20 border-t-purple-600 rounded-full animate-spin" />
    : <SparklesIcon size={14} />}
</button>
```

### 处理函数

```typescript
const handleHumanize = async (chapterNum: number, style: "conservative" | "aggressive" = "conservative") => {
  setHumanizingChapters((prev) => [...prev, chapterNum]);
  try {
    await fetchJson(`/books/${bookId}/humanize/${chapterNum}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ style }),
    });
    refetch();
  } catch (e) {
    alert(e instanceof Error ? e.message : "Humanize failed");
  } finally {
    setHumanizingChapters((prev) => prev.filter((n) => n !== chapterNum));
  }
};
```

## 📊 处理参数

### 默认参数
- `style`: "conservative"（保守策略）
- `register`: 自动检测

### 可选参数
可以在代码中修改调用，传入不同的参数：

```typescript
// 使用激进策略
handleHumanize(chapterNum, "aggressive");

// 指定语体
await fetchJson(`/books/${bookId}/humanize/${chapterNum}`, {
  method: "POST",
  body: JSON.stringify({ 
    style: "conservative",
    register: "written" // social | content | business | written | academic
  }),
});
```

## 🎯 功能特点

### 1. 门检保护
- 检测是否为真人写作
- 如果检测到真人痕迹（自纠语气、地域词等），会停手不改
- 避免误改作者的个人风格

### 2. 语体感知
- 自动识别章节的语体类型
- 不同语体使用不同的 AI 腔检测规则
- 学术/公文语体会保留规范表达

### 3. 保守编辑
- 默认使用保守策略
- 只改明显的 AI 腔
- 保留原文的语气和节奏

### 4. 状态反馈
- 按钮悬停显示
- 加载时显示旋转动画
- 处理完成后自动刷新页面

## 🔍 操作栏布局

章节操作栏从左到右依次为：

1. ✅ **通过** (仅待审核章节) - 绿色
2. ❌ **拒绝** (仅待审核章节) - 红色
3. 🛡️ **审计** - 灰色
4. 🔄 **重写** - 灰色
5. 🔄 **同步** - 灰色
6. ✨ **去 AI 味** - 紫色 ⬅️ 新增
7. 📝 **修订菜单** - 下拉选项

## 📊 修改后的效果

### 输入示例（AI 腔浓）
```
随着科技的不断发展，AI 技术已经深入到我们生活的方方面面。
值得一提的是，这项技术不仅提高了效率，更重要的是为人们带来了便利。
不可否认，未来 AI 将在更多领域发挥重要作用，谱写新的篇章。
```

### 输出示例（去 AI 味后）
```
AI 技术已经渗透到生活的各个角落。
它确实提高了效率，也给人们带来了便利。
未来，AI 会在更多领域发挥作用。
```

## ⚠️ 注意事项

### 1. 门检机制
如果章节是真人写作（有自纠语气、地域词、具体细节等），系统会停手不改。

### 2. 不发明事实
终稿里的具体数字/事件/人物/引用，原文都得有依据。

### 3. 保留毛边
至少保留一处真人痕迹（主观判断/具体感受）。

### 4. 并发处理
- 可以同时处理多个章节
- 每个章节独立显示加载状态
- 处理完成后自动刷新

## 🎨 视觉设计

### 颜色方案
- **背景**: `bg-purple-500/10` (10% 紫色)
- **文字**: `text-purple-600` (深紫色)
- **悬停**: `hover:bg-purple-500` (实心紫色)
- **悬停文字**: `hover:text-white` (白色)

### 动画效果
- **加载**: 紫色旋转圈 `animate-spin`
- **悬停**: 背景渐变 + 文字颜色变化
- **显示**: 鼠标悬停时操作栏淡入 `opacity-0 group-hover:opacity-100`

## 📝 相关文件

- **前端组件**: `packages/studio/src/pages/BookDetail.tsx`
- **API 端点**: `packages/studio/src/api/server.ts`
- **Agent 实现**: `packages/core/src/agents/ai-taste-remover.ts`
- **使用文档**: `packages/core/src/agents/README.ai-taste-remover.md`

## 🚀 下一步优化

- [ ] 添加语体选择下拉菜单
- [ ] 添加策略选择（保守/激进）
- [ ] 显示打磨报告 UI
- [ ] 添加修改前后对比视图
- [ ] 支持批量去 AI 味（全书）
- [ ] 支持撤销操作

## 💡 使用建议

1. **写作完成后使用** - 建议在章节写完后再去 AI 味
2. **不要过度使用** - 如果章节已经是真人风格，门检会停手
3. **结合修订功能** - 可以先去 AI 味，再用修订功能微调
4. **检查修改结果** - 处理完成后建议人工检查一遍

## 🎯 适用场景

✅ **适合使用**:
- AI 生成的初稿
- AI 腔明显的章节
- 需要降低 AI 检测分数的内容

❌ **不适合使用**:
- 真人写作的内容（门检会停手）
- 学术/公文等规范文体（会保留规范表达）
- 已有个人风格的文字

---

**提示**: 如果处理失败，可能是以下原因：
1. 章节文件不存在
2. API 服务未启动
3. 网络问题
4. 检测到真人写作（门检停手）
