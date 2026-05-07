const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("no #app");

root.innerHTML = `
  <main>
    <header>
      <h1>Vite fixture</h1>
      <p>This is a tiny Vite app DoceoMenter boots and screenshots in its integration tests.</p>
    </header>
    <section class="grid">
      <article>
        <h2>What it does</h2>
        <p>Renders this page. That's it. The point is to give the capture engine a real dev server to talk to.</p>
      </article>
      <article>
        <h2>Why it exists</h2>
        <p>Because the static fixture proves the static path; this proves the dev-server path with HMR and module loading.</p>
      </article>
      <article>
        <h2>What to look at</h2>
        <p>The gradient header, the three-column layout, and the focus styles on the button below.</p>
      </article>
    </section>
    <footer>
      <button class="cta" id="cta">Engage</button>
    </footer>
  </main>
`;

document.querySelector("#cta")?.addEventListener("click", () => {
  document.body.classList.toggle("engaged");
});
