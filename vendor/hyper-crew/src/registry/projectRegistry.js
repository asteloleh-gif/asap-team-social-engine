const DEFAULT_PROJECTS = Object.freeze([
  Object.freeze({
    id: "astel-business",
    name: "Astel Business",
    brands: ["leoakastel", "astel.u", "astel.us"],
    defaultLanguage: "auto",
  }),
  Object.freeze({
    id: "battle-box",
    name: "Battle Box",
    brands: ["astel-family", "battle-box"],
    defaultLanguage: "en",
  }),
  Object.freeze({
    id: "asap-gta6",
    name: "ASAP GTA6",
    brands: ["asap-gta6"],
    defaultLanguage: "en",
  }),
]);

function createProjectRegistry(projects = DEFAULT_PROJECTS) {
  const registry = new Map(projects.map(project => [project.id, Object.freeze({ ...project })]));
  return {
    get(projectId) {
      return registry.get(String(projectId || "").trim()) || null;
    },
    list() {
      return [...registry.values()];
    },
  };
}

module.exports = { DEFAULT_PROJECTS, createProjectRegistry };
