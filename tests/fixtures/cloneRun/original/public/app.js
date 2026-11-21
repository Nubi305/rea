/* Quillbrook client script: adds, finds, renames and deletes topics through the JSON API. */
(function () {
  const MESSAGES = {
    title_required: "Enter a title",
    title_length: "Title must be 3 to 48 characters",
    title_taken: "That title is already in use",
    pinned: "Pinned topics cannot be deleted",
    not_found: "This topic no longer exists",
  };

  function notice(role, text) {
    const box = document.getElementById("notice");
    box.textContent = "";
    if (!text) return;
    const line = document.createElement("p");
    line.setAttribute("role", role);
    line.textContent = text;
    box.appendChild(line);
  }

  function call(method, path, body) {
    const options = { method: method, headers: {} };
    if (body !== undefined) {
      options.headers["content-type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    return fetch(path, options).then(function (response) {
      return response.json().then(function (data) {
        return { ok: response.ok, data: data };
      });
    });
  }

  function row(topic) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = "/topic?id=" + topic.id;
    link.textContent = topic.title;
    const slug = document.createElement("code");
    slug.textContent = topic.slug;
    item.appendChild(link);
    item.appendChild(document.createTextNode(" "));
    item.appendChild(slug);
    if (topic.pinned) {
      const mark = document.createElement("strong");
      mark.textContent = "pinned";
      item.appendChild(document.createTextNode(" "));
      item.appendChild(mark);
    }
    return item;
  }

  function showList(topics) {
    const list = document.getElementById("topics");
    list.textContent = "";
    topics.forEach(function (topic) {
      list.appendChild(row(topic));
    });
  }

  const addForm = document.getElementById("add-form");
  if (addForm) {
    addForm.addEventListener("submit", function (event) {
      event.preventDefault();
      const title = addForm.elements.title.value;
      if (title.trim() === "") return notice("alert", MESSAGES.title_required);
      void call("POST", "/api/topics", {
        title: title,
        pinned: addForm.elements.pinned.checked,
      }).then(function (result) {
        if (!result.ok) return notice("alert", MESSAGES[result.data.error]);
        const list = document.getElementById("topics");
        const pinnedRows = list.querySelectorAll("li strong").length;
        const before = result.data.pinned ? list.children[pinnedRows] : null;
        list.insertBefore(row(result.data), before || null);
        addForm.reset();
        notice("status", "Added " + result.data.title);
      });
    });
  }

  const findForm = document.getElementById("find-form");
  if (findForm) {
    findForm.addEventListener("submit", function (event) {
      event.preventDefault();
      const q = findForm.elements.q.value;
      void call("GET", "/api/topics?q=" + encodeURIComponent(q)).then(
        function (result) {
          showList(result.data.items);
          notice("status", result.data.total + " found");
        },
      );
    });
  }

  const renameForm = document.getElementById("rename-form");
  if (renameForm) {
    renameForm.addEventListener("submit", function (event) {
      event.preventDefault();
      const title = renameForm.elements.title.value;
      if (title.trim() === "") return notice("alert", MESSAGES.title_required);
      void call("PUT", "/api/topics/" + renameForm.dataset.id, {
        title: title,
      }).then(function (result) {
        if (!result.ok) return notice("alert", MESSAGES[result.data.error]);
        document.getElementById("topic-title").textContent = result.data.title;
        renameForm.reset();
        notice("status", "Renamed");
      });
    });
  }

  const deleteButton = document.getElementById("delete-topic");
  if (deleteButton) {
    deleteButton.addEventListener("click", function () {
      void call("DELETE", "/api/topics/" + deleteButton.dataset.id).then(
        function (result) {
          if (!result.ok) return notice("alert", MESSAGES[result.data.error]);
          deleteButton.disabled = true;
          notice("status", "Topic deleted");
        },
      );
    });
  }
})();
