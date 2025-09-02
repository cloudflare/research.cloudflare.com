# research.cloudflare.com

> Source code for the website https://research.cloudflare.com

> Built with Eleventy https://www.11ty.dev/

> _uses Node 14 for building only_, not a runtime dependency

---

### Install build dependencies:

```
nvm install 14
npm install
```

### Work locally (with source file watching and browser refresh):

```
npm start
```

### Build locally (and better simulate what Cloudflare Pages will produce):

(you'll need [cloudflared](https://github.com/cloudflare/cloudflared) and [ImageMagick](https://imagemagick.org/index.php) installed for some of the build tasks)

```
npm run build
```

### Format code

Getting linting errors in CI?
[Install Prettier](https://prettier.io/docs/en/install.html) locally and run:

```
prettier -w .
```

### Markdown references

- [Easy reference](https://guides.github.com/features/mastering-markdown/)
- [Commonmark](https://spec.commonmark.org/current/) (the latest language spec)
- [markdown-it](https://github.com/markdown-it/markdown-it) (the library used to process Markdown when building)

---

Copyright &copy; 2025 Cloudflare
