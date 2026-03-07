const tabButtons = document.querySelectorAll("[data-tab-target]");
const tabPanes = document.querySelectorAll(".tab-pane");

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    const targetId = button.getAttribute("data-tab-target");

    for (const otherButton of tabButtons) {
      otherButton.classList.toggle("tab-button-active", otherButton === button);
    }

    for (const pane of tabPanes) {
      pane.classList.toggle("tab-pane-active", pane.id === targetId);
    }
  });
}
