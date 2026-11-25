/* ------------------------------------------------------------------
   Luxpackers CRM — settings
   This is the only file you normally need to change.
   ------------------------------------------------------------------ */
window.LUX_CONFIG = {
  companyName: "Luxpackers",

  /* The shared Google Sheet connection.
     Leave empty ("") and the CRM saves on this computer only.
     After you follow README → "Connect the shared Google Sheet",
     paste the web-app address between the quotes, for example:
     sheetApiUrl: "https://script.google.com/macros/s/AKfy.../exec"   */
  sheetApiUrl: "",

  /* Sign-in codes used ONLY while sheetApiUrl is empty.
     Once the Google Sheet is connected, the codes live safely inside
     the Google script instead (README explains where). */
  localTeamCode: "luxpackers",
  localAdminCode: "luxadmin"
};
