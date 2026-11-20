// Server-rendered pages of Tidewater.
const escapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const text = (value) => String(value).replace(/[&<>"]/g, (c) => escapes[c]);

const page = (heading, content) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <title>Tidewater: ${text(heading)}</title>
    <link rel="stylesheet" href="/assets/board.css">
    <script type="module" src="/assets/board.js"></script>
  </head>
  <body>
    <header class="masthead">
      <h1>Tidewater</h1>
      <nav aria-label="Sections"><a href="/">Topics</a> <a href="/about">About</a></nav>
    </header>
    <main>${content}</main>
    <footer>Tidewater is a small shared topic board.</footer>
  </body>
</html>
`;

export const topicItem = (topic) =>
  `<li data-topic="${topic.id}"><a href="/topic?id=${topic.id}">${text(topic.title)}</a> <code>${text(topic.slug)}</code>${
    topic.pinned ? " <strong>pinned</strong>" : ""
  }</li>`;

export const home = (topics) =>
  page(
    "Topics",
    `
      <section>
        <h2>Topics</h2>
        <form data-action="find">
          <label>Find <input name="q" type="text" autocomplete="off"></label>
          <button>Search</button>
        </form>
        <ul aria-label="Topic list" data-list>${topics.map(topicItem).join("")}</ul>
      </section>
      <section>
        <h2>New topic</h2>
        <form data-action="add">
          <label>Title <input name="title" type="text" autocomplete="off"></label>
          <label><input name="pinned" type="checkbox"> Pinned</label>
          <button>Add topic</button>
        </form>
      </section>
      <div data-notice></div>
    `,
  );

export const topic = (item) =>
  page(
    item.title,
    `
      <h2 data-title>${text(item.title)}</h2>
      <p>Slug: <code>${text(item.slug)}</code></p>
      <p>This topic is ${item.pinned ? "" : "not "}pinned.</p>
      <form data-action="rename" data-topic="${item.id}">
        <label>New title <input name="title" type="text" autocomplete="off"></label>
        <button>Rename</button>
      </form>
      <button type="button" data-action="delete" data-topic="${item.id}">Delete topic</button>
      <div data-notice></div>
    `,
  );

export const about = () =>
  page(
    "About",
    `
      <h2>About</h2>
      <p>Tidewater is a shared board of topics. Each topic gets a short address made from its first title.</p>
      <p>Pinned topics stay at the top of the list.</p>
    `,
  );

export const missing = () =>
  page(
    "Not found",
    `
      <h2>No such topic</h2>
      <p><a href="/">Back to topics</a></p>
    `,
  );
