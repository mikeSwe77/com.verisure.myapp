'use strict';

// App Web API for the settings page (settings/index.html). Routes are declared under "api"
// in .homeycompose/app.json. Nothing here returns passwords or cookies.

module.exports = {

  async getAccounts({ homey }) {
    return homey.app.getAccountsOverview();
  },

  async signOut({ homey, body }) {
    return homey.app.signOut(body && body.email);
  },

};
