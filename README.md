# LectureInk

LectureInk is a free, open-source browser extension that takes notes while you watch a lecture video. It reads the captions (or the audio) and watches the picture. It then writes structured notes into your own markdown folder, such as an Obsidian vault:

- **Notes**: timestamped headings and bullets. Each timestamp links back to that moment in the video.
- **Code**: code that appears on screen is copied exactly, together with what the instructor said about it.
- **Diagrams**: boxes and arrows drawn on screen are rebuilt as editable [Excalidraw](https://excalidraw.com) drawings. The source frame stays attached for comparison.
- **Screenshots and flags**: one click saves the current frame or marks a moment to revisit.
- **Ask about this lesson**: chat with an AI model that answers from your notes and the transcript.

It works on YouTube, Udemy, Coursera, and any other page with a `<video>`, in Chrome and Edge.

There is no LectureInk server and no account. You bring your own API key, and everything stays in your browser and your notes folder. Video frames and transcript text are sent only to the AI provider you choose.

## Install (from source)

Requirements: Node.js 20 or later.

```bash
npm install
npm run build            # Chrome / Edge → .output/chrome-mv3
```

- **Chrome / Edge**: open `chrome://extensions` (or `edge://extensions`), turn on Developer mode, click **Load unpacked**, and choose `.output/chrome-mv3`.

For development with live reload, use `npm run dev`.

## Getting started

### 1. Open LectureInk

Open a lecture video, then click the LectureInk button in the browser toolbar. The LectureInk panel opens on the right side of the window.

### 2. Connect your notes folder

Click the gear icon at the top of the panel to open **Settings**. Under **Notes folder**, click **Choose** and pick the folder where your notes should go, such as your Obsidian vault. When the browser asks, allow LectureInk to edit files in that folder. Once a folder is connected, its name shows there and the button changes to **Change**, so you can pick a different folder later.

After a browser restart, the panel may show **Click to reconnect your notes folder**. Click it once to give access again.

### 3. Add your AI key

Under **AI**, pick your provider (Claude, OpenAI, Gemini, Grok, Kimi or Local) and paste your API key into the key box. There is no button to press. LectureInk checks the key on its own as soon as you paste it:

- **Correct key**: a message below the model list says **Connected to \<provider\>. N models available.** The model list then shows every model your key can use.
- **Wrong key**: the message says **Could not connect to \<provider\>**. Check the key and paste it again.

Pick a model from the list. Choose one that can read images, so LectureInk can read code and diagrams from the video.

Settings are saved as you change them. Click the back arrow to return to your notes.

### 4. Watch the lecture

Press play. The status button at the top changes to **Listening**, and notes appear in the panel as the lecture goes on. Click that button to pause or resume note-taking.

Keep the panel open while you watch. Closing it stops note-taking.

### 5. Use the panel

- **Notes, Transcript, Diagrams, Code** tabs: the full note, the spoken text, and just the diagrams or code.
- **Timestamps**: click any time to jump the video to that moment.
- **Diagrams**: click a diagram to edit it in Excalidraw.

**Ask AI** (the button at the bottom right) opens a chat about the lesson you are watching. Type a question, such as "Why does the key decide the partition?" or "Explain this code more simply", and press **Ask**.

- The AI reads your notes, captured code, diagrams and the lecture transcript so far before it answers. Its answers are about this lecture, not general guesses.
- If the lecture did not cover your question, the AI says so, then answers from general knowledge and marks that part.
- You can ask follow-up questions. The AI remembers the earlier questions in the same chat.
- Click **Add to notes** under an answer to keep it. It is added to your notes as a "Q: \<your question\>" section, so it is also saved to your folder and included in PDF and Word exports.
- The chat is not saved. When you go back to the notes, the conversation is cleared, so add any answers you want to keep first.
- Ask AI uses the same AI provider, key and model you set in Settings.

The three buttons at the bottom left of the panel let you add things to your notes yourself:

- **Screenshot (camera icon)**: saves a picture of the video at this exact moment. Only the video is captured, not the rest of the page. The picture appears in your notes at that time, is saved into the lesson's `attachments` folder, and is included in the PDF and Word exports. LectureInk also takes screenshots on its own when the video shows something worth keeping as a picture, such as a chart, a table, a formula or an app being demonstrated. Use the button for anything else you want to keep.
- **Flag (flag icon)**: marks this moment as important, for example something you did not understand or want to revise. LectureInk adds a highlighted note with what the instructor just said, plus a timestamp you can click to come back to it. In the saved `.md` note, a flag appears as an "important" callout.
- **Capture code on screen (`<>` icon)**: use it when the instructor shows code. LectureInk takes the current video frame and asks your AI model to copy the code exactly. The code appears in the **Notes** and **Code** tabs, with syntax colours and a short summary of what the instructor said about it. LectureInk already looks for code on its own while you watch. This button makes it read the screen right now, even if **Capture code with explanation** is off in Settings.

### 6. Your saved notes

**Saved automatically.** While the folder is connected, LectureInk writes the note, its screenshots and its diagrams into your folder every few seconds. Nothing needs to be clicked. Each lesson gets its own folder:

```
<notes folder>/<Course>/<Lesson>/<Lesson>.md
<notes folder>/<Course>/<Lesson>/attachments/<mm-ss>.jpg
<notes folder>/<Course>/<Lesson>/diagrams/<mm-ss>-<title>.excalidraw.md
```

To open the diagram files in Obsidian, install the Obsidian **Excalidraw** plugin.

**Save as PDF or Word.** On the **Notes** tab, next to the lesson title:

- **PDF** opens the whole note in a new tab with the print dialog. Choose **Save as PDF** as the printer.
- **Word** downloads the whole note as a `.docx` file.

Both include the notes, code, screenshots and diagrams in one document.

### AI providers

| Provider | Notes |
|---|---|
| Claude | Default model `claude-opus-5-5` |
| OpenAI, Gemini, Grok, Kimi | Use their OpenAI-compatible endpoints |
| Local | Any OpenAI-compatible server. For Ollama, start it with `OLLAMA_ORIGINS=chrome-extension://*` |

Pick a model that can read images. Settings lists each provider's current models once you enter its API key, and shows a short built-in list until then.

### Lectures without captions

When a playing video shows no captions for 20 seconds, LectureInk records the video's audio in 30-second chunks. It sends each chunk to a speech-to-text service you configure in Settings: OpenAI, Groq, or a local OpenAI-compatible Whisper server.

### Known limits

- **DRM-protected players** (some paid courses) show a black picture to screen capture, and their audio cannot be recorded. Notes then come from captions only.
- **Videos inside cross-origin iframes** are captured as the whole visible tab, not cropped to the video.
- **The side panel must stay open** while you watch. Closing it stops note-taking.
- **Per-site selectors** for titles and captions live in [lib/platforms.ts](lib/platforms.ts). They break when sites redesign their pages, and pull requests that fix them are welcome.

## Privacy

- API keys are stored in `storage.local` on this device and are never synced.
- Requests go straight from your browser to the provider you choose. LectureInk has no server.
- Lesson data lives in the browser's IndexedDB and in the folder you choose.

## Project layout

```
entrypoints/
  background.ts      opens the side panel
  content.ts         runs in pages: finds the video, reads captions, records audio, seeks
  sidepanel/         the UI and the capture engine (engine.ts)
lib/                 pure logic: notes → markdown, scene detection, Excalidraw files, AI calls, vault
```

See [CONTRIBUTING.md](CONTRIBUTING.md) to get involved.

## License

[MIT](LICENSE). The Excalidraw fonts bundled into the build are licensed under the SIL Open Font License.
