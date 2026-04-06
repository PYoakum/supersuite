/**
 * Static route - serve dashboard HTML
 */

import { htmlResponse } from "../middleware.js";
import { getThemedHTML } from "../../web/template.js";

export function handleDashboard() {
  return htmlResponse(getThemedHTML());
}
