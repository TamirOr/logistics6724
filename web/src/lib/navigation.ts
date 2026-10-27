import type { Location, NavigateFunction } from "react-router-dom";

/**
 * The header's back arrow. Within the app it returns to the previous
 * screen. On a page opened directly (a link, a notification, a new tab)
 * there is no previous screen in the app, and history back would leave it,
 * so it goes to the home screen instead.
 */
export function goBack(navigate: NavigateFunction, location: Pick<Location, "key">): void {
  // React Router gives the first location of a session the key "default".
  if (location.key === "default") navigate("/", { replace: true });
  else navigate(-1);
}
