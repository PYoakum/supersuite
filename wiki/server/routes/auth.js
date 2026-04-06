import { html, redirect, createSessionToken, sessionCookie } from "../middleware.js";
import { loginPage } from "../../web/pages/login.js";

export function registerAuthRoutes(router) {
  router.get("/login", async (req, ctx) => {
    if (ctx.loggedIn === true) {
      return redirect("/wiki/home");
    }
    const returnTo = ctx.url.searchParams.get("return") || "";
    return html(loginPage(ctx.config, ctx.loggedIn, { returnTo }));
  });

  router.post("/login", async (req, ctx) => {
    const form = await req.formData();
    const password = form.get("password") || "";
    const returnTo = form.get("return") || "/wiki/home";

    if (password !== ctx.config.auth.edit_password) {
      return html(loginPage(ctx.config, false, { error: "Invalid password", returnTo }));
    }

    const token = await createSessionToken(ctx.config);
    const cookie = sessionCookie(ctx.config, token, ctx.config.auth.max_age);
    return redirect(returnTo || "/wiki/home", { "Set-Cookie": cookie });
  });

  router.post("/logout", async (req, ctx) => {
    const cookie = sessionCookie(ctx.config, "", 0);
    return redirect("/wiki/home", { "Set-Cookie": cookie });
  });
}
