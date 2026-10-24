// Point download links at the files in the latest release, and highlight this visitor's OS.
(function () {
  var ua = navigator.userAgent;
  var os = /Windows/.test(ua) ? "windows" : /Mac OS X|Macintosh/.test(ua) ? "mac" : /Linux|X11/.test(ua) ? "linux" : null;
  var names = { windows: "Windows", mac: "macOS", linux: "Linux" };
  if (os) {
    var card = document.querySelector('[data-os="' + os + '"]');
    if (card) card.classList.add("recommended");
    var primary = document.querySelector("[data-download-primary] span");
    if (primary) primary.textContent = "Download for " + names[os];
  }

  if (!document.querySelector("[data-asset]")) return;
  fetch("https://api.github.com/repos/derhally/niimbot-studio/releases/latest")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (release) {
      if (!release || !release.assets) return;
      document.querySelectorAll("[data-asset]").forEach(function (link) {
        var asset = release.assets.find(function (a) { return a.name.endsWith(link.dataset.asset); });
        if (asset) link.href = asset.browser_download_url;
      });
      var label = document.querySelector("[data-release]");
      if (label) label.textContent = "Version " + release.tag_name.replace(/^v/, "") + ", free for Windows, macOS and Linux.";
    })
    .catch(function () {});
})();

// Guide: highlight the section you're reading in the sidebar.
(function () {
  var links = document.querySelectorAll(".toc a");
  if (!links.length || !("IntersectionObserver" in window)) return;
  var byId = {};
  links.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      links.forEach(function (a) { a.classList.remove("active"); });
      var a = byId[e.target.id];
      if (a) a.classList.add("active");
    });
  }, { rootMargin: "-80px 0px -70% 0px" });
  Object.keys(byId).forEach(function (id) {
    var el = document.getElementById(id);
    if (el) observer.observe(el);
  });
})();
