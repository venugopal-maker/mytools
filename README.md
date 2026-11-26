# My Tools

A small collection of free browser tools with one homepage. Everything runs in your browser, so your files are never uploaded to any server.

## Tools

| Tool | What it does | Folder |
|------|--------------|--------|
| **VoiceScribe** | Converts video or audio into text. Supports subtitles (.srt), audio extraction and translation. | `voicescribe/` |
| **Video Converter** | Turns a video into images (ZIP) or a PDF. | `video-converter/` |
| **Image Studio** | Compresses a photo to a size you choose (KB or MB), resizes it to passport sizes, and adds text such as a name and date. | `image-studio/` |

## Project structure

```
my-tools/
├── index.html          Homepage that links to all tools
├── README.md
├── voicescribe/
│   ├── index.html
│   ├── style.css
│   └── script.js
├── video-converter/
│   ├── index.html
│   ├── style.css
│   └── script.js
└── image-studio/
    ├── index.html
    ├── style.css
    └── script.js
```

## Run on your computer

VoiceScribe uses a JavaScript module, which browsers block when a page is opened by double-clicking the file. Start a small local server instead:

1. Open a terminal in the `my-tools` folder.
2. Run `python -m http.server 8000`
3. Open `http://localhost:8000` in Chrome or Edge.

Or use the **Live Server** extension in VS Code and open the homepage `index.html` with it.

## Publish on GitHub Pages

1. Upload everything in this folder to a public GitHub repository, keeping the folders.
2. Open **Settings → Pages**.
3. Under **Branch**, choose `main` and `/ (root)`, then click **Save**.
4. After a minute or two the site is live at `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`.

## Add a new tool

1. Create a new folder, for example `pdf-tools/`, and put its `index.html`, `style.css` and `script.js` inside.
2. Open the homepage `index.html` and add one line to the `SITES` list:

```js
{ name: "PDF Tools", icon: "📄", desc: "Compress and convert PDFs.", link: "pdf-tools/index.html" },
```

3. Commit and push. The new card appears on the homepage.

You can also change the homepage title and tagline at the top of the same section (`SITE_TITLE` and `TAGLINE`).

## Notes

- Use Chrome or Edge on a computer for the best results. VoiceScribe is fastest on a device with a GPU.
- VoiceScribe downloads its speech model the first time you use it. After that it is cached by the browser.
- Translation in VoiceScribe needs Chrome 138 or newer.
- File and folder names are case-sensitive on GitHub. Keep them lowercase.
