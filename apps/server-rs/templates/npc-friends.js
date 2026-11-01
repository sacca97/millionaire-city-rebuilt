// Offline NPC friends for the ORIGINAL Flash client (served at /local/npc-friends.js, loaded into the launcher page by the desktop app
// and by the oracle harness; not part of launcher.html so that page stays byte-identical to the TS server's).
// The original asks Facebook to deliver "investOnFriend" app requests (Flash -> flashRequest_Received("fbRequest", {action:"investmentRequest"}));
// the friends accept them later on Facebook and the web server creates the investment rows. Here the NPC friends accept at once:
// the server creates the rows (POST /local/npc-invest) and the page reloads the game so the investment portfolio shows them.
(function () {
  if (window.__mcityNpcFriends) return;
  window.__mcityNpcFriends = true;
  var original = window.launchFacebookRequest;
  window.launchFacebookRequest = function (params) {
    if (params && params.action === "investmentRequest") {
      fetch("/local/npc-invest", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (typeof notify === "function") notify("Investment accepted by " + (j.created || 0) + " NPC friend(s).", "status-ok");
          if (j.created > 0) window.location.reload();
        })
        .catch(function () {
          if (typeof notify === "function") notify("Could not reach the local server.", "status-error");
        });
      return;
    }
    return original ? original.apply(this, arguments) : undefined;
  };
})();
