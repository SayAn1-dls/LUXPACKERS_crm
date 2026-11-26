/* Starting records, loaded once into an empty CRM (Settings → Load starting records).
   Taken from a review of luxpackers.com, the admin dashboard and the trip itineraries on 24 Nov 2026. */
(function () {
  const D = "https://lux-dashord.vercel.app", W = "https://www.luxpackers.com";
  const L = (label, url) => [{ label, url }];
  const t = (title, dept, owner, priority, status, due, links, notes) => ({ title, dept, owner, priority, status, due, links: links || [], notes: notes || "" });

  const tasks = [
    t("Publish trips on the website — the Packages page shows no trips today", "Trips & Content", "Content intern", "High", "Not done", "2026-11-30", L("Dashboard · Trips", D + "/trips"), "Nothing can be booked online until trips are published."),
    t("Enter the nine ready itineraries into the Trip Builder", "Trips & Content", "Content intern", "High", "To do", "2026-12-05", L("Dashboard · New trip", D + "/trips/new"), "Thailand, Vietnam New Year, Sri Lanka, Vietnam In Depth, Japan Fuji to Osaka, Bali, Japan Group, Georgia and Egypt. Tick each step on the Trips page."),
    t("Add the missing destinations: Sri Lanka, Japan, Georgia, Egypt", "Trips & Content", "Content intern", "High", "To do", "2026-11-27", L("Dashboard · Destinations", D + "/destinations"), "Trips for these countries cannot be saved until the destination exists."),
    t("Correct the China destination — its text and cover photo belong to Malaysia", "Trips & Content", "Content intern", "Medium", "To do", "2026-11-28", L("Dashboard · Destinations", D + "/destinations")),
    t("Write a description and add a cover photo for Dubai and Himachal Pradesh", "Trips & Content", "Design intern", "Medium", "To do", "2026-11-29", L("Dashboard · Destinations", D + "/destinations")),
    t("Retire “Ziro Festival of Music 2025” as a destination or move it to Luxperiences", "Trips & Content", "Content intern", "Low", "To do", "2026-12-03", L("Dashboard · Destinations", D + "/destinations"), "A past event is listed as a place."),
    t("Create departure batches for group trips so the Group Trips page is not empty", "Operations", "Ops intern", "High", "To do", "2026-11-27", L("Dashboard · Trips", D + "/trips"), "Vietnam New Year: 22 Dec 2026 to 1 Jan 2027. Japan Group: waiting for dates."),
    t("Share the Japan Group departure dates and number of seats", "Management", "CEO", "High", "To be given", "2026-11-27", [], "Needed before the Japan Group batch can be created."),
    t("Set rupee prices for Thailand, Sri Lanka, Japan Fuji to Osaka, Bali and Georgia", "Finance", "CFO", "High", "To be given", "2026-11-28", [], "Full amount and token amount are required to publish a trip. Georgia only has a USD estimate."),
    t("Agree one advance (token) policy for every trip", "Finance", "CFO", "High", "To do", "2026-11-28", [], "Vietnam New Year asks 50% today, Japan Group 40%."),
    t("Confirm GST 5% + TCS 2% wording and the payee name on invoices", "Finance", "CFO", "Medium", "To do", "2026-12-02"),
    t("Confirm with the Egypt partner: museum ticket included, and the price for new dates", "Finance", "CFO", "Medium", "To be given", "2026-11-30", [], "Last quote was ₹66,777 per person for November 2025."),
    t("Review coupons before any go live", "Finance", "CFO", "Low", "To do", "2026-12-05", L("Dashboard · Coupons", D + "/coupons")),
    t("Monday review of bookings and money received", "Finance", "CFO", "Medium", "To do", "2026-11-30", L("Dashboard · Bookings", D + "/bookings"), "Every Monday."),
    t("Add at least three Luxperiences", "Marketing", "Marketing intern", "Medium", "To do", "2026-12-06", L("Dashboard · Experiences", D + "/experiences"), "The Luxperiences page is empty."),
    t("Publish five travel tips", "Marketing", "Content intern", "Medium", "To do", "2026-12-06", L("Dashboard · Tips", D + "/tips")),
    t("Remove the test story and publish real travel stories", "Marketing", "Content intern", "Medium", "To do", "2026-11-29", L("Dashboard · Blogs", D + "/blogs"), "Only “QA Guide: Choosing Your Bali Stay Tier” is live."),
    t("Replace homepage reviews about Santorini, Tanzania and Tuscany with real guest reviews", "Marketing", "Marketing intern", "Medium", "To be given", "2026-12-02", L("Website", W), "Needs real quotes from guests, with their permission."),
    t("Add Instagram reels to each trip page", "Marketing", "Marketing intern", "Low", "To do", "2026-12-10", L("Dashboard · Trips", D + "/trips")),
    t("Correct the homepage spelling “Live Iteneraries”", "Technology", "CTO", "Low", "To do", "2026-11-29", L("Website", W)),
    t("Find out why “Vietnam Roadtrip Experience” is not showing on the website", "Technology", "CTO", "Medium", "To do", "2026-11-27", L("Dashboard · Trips", D + "/trips"), "It is marked published in the dashboard."),
    t("Check the plan of the website's server on Render", "Technology", "CTO", "Medium", "To do", "2026-11-30", [], "A free plan sleeps when idle, which makes the first visit slow."),
    t("Set up alerts if the website or server goes down", "Technology", "CTO", "Low", "To do", "2026-12-07"),
    t("List everyone with admin access to the dashboard and remove former interns", "Technology", "CTO", "High", "To do", "2026-11-27", L("Admin dashboard", D), "Record each person in the Access register."),
    t("Connect this CRM to the shared Google Sheet so everyone sees the same data", "Technology", "CTO", "High", "To do", "2026-11-26", [], "Follow the README, section “Connect the shared Google Sheet”."),
    t("Review notification templates before the first campaign", "Technology", "CTO", "Low", "To do", "2026-12-07", L("Dashboard · Notifications", D + "/notifications")),
    t("Review internship applications", "People & Interns", "CEO", "Medium", "To do", "2026-11-30", L("Dashboard · Internship applications", D + "/internship-applications"), "Every week."),
    t("Replace the role names on the Team page with each person's real name", "People & Interns", "CEO", "High", "To do", "2026-11-26", [], "Names entered there appear in every Owner list."),
    t("Answer support requests within 24 hours", "Sales & Reservations", "Ops intern", "High", "To do", "2026-11-25", L("Dashboard · Support requests", D + "/support-requests"), "Every day."),
    t("Record every open enquiry in Enquiries, with a follow-up date", "Sales & Reservations", "Sales lead", "High", "To do", "2026-11-27"),
    t("Share hotel names and photos for each trip — itineraries only say “or similar”", "Operations", "Operations lead", "Medium", "To be given", "2026-12-02"),
    t("Prepare cover and gallery photos for all nine trips", "Trips & Content", "Design intern", "High", "To do", "2026-12-04", [], "Cover photos: landscape, 1200 × 675."),
    t("Privacy, Terms and Refund pages published", "Technology", "CTO", "Low", "Done", "2026-07-12", L("Website · Terms", W + "/terms-and-conditions")),
    t("Support and Report-an-issue forms live on the website", "Technology", "CTO", "Low", "Done", "2026-11-24", L("Website · Support", W + "/support")),
    t("Internship application form live on the website", "Technology", "CTO", "Low", "Done", "2026-11-24", L("Website · Internship", W + "/internship")),
    t("Admin dashboard built: trips, batches, bookings, customers, coupons, destinations, content, support and notifications", "Technology", "CTO", "Medium", "Done", "2026-11-24", L("Admin dashboard", D))
  ];

  const S = ["Itinerary ready", "Destination added", "Entered in dashboard", "Photos ready", "Price set", "Batches added", "Live on website"];
  const trip = (name, destination, kind, duration, price, steps, notes) => ({ name, destination, kind, duration, price: price || "", status: "In preparation", owner: "Content intern", steps, links: [], notes: notes || "" });
  const trips = [
    trip("Island Escape & City Adventures", "Thailand", "Private", "7 days / 6 nights", "", [S[0], S[1], S[5]], "Private trip, no batch needed. Price to be set."),
    trip("Vietnam New Year's Signature Trip", "Vietnam", "Group", "11 days / 10 nights", "66999", [S[0], S[1], S[4]], "Batch to create: 22 Dec 2026 to 1 Jan 2027."),
    trip("Sri Lanka Island Loop", "Sri Lanka", "Private", "7 days / 6 nights", "", [S[0], S[5]], "Destination to add first. Price to be set."),
    trip("Vietnam In Depth", "Vietnam", "Group", "9 days / 8 nights", "75000", [S[0], S[1], S[4]], "New departure dates needed."),
    trip("Japan, Fuji to Osaka Bay", "Japan", "Private", "8 days / 7 nights", "", [S[0], S[5]], "Destination to add first. Price to be set."),
    trip("Bali Customisable Trip", "Bali", "Private", "9 days / 8 nights", "", [S[0], S[1], S[5]], "Price to be set."),
    trip("Japan Group Trip", "Japan", "Group", "10 days / 9 nights", "159999", [S[0], S[4]], "Destination to add first. Dates and seats to be given."),
    trip("Georgia — A Couple's Winter Journey", "Georgia", "Private", "7 days / 6 nights", "", [S[0], S[5]], "Destination to add first. Only a USD estimate so far."),
    trip("Egypt: Cairo & Alexandria", "Egypt", "Private", "7 days / 6 nights", "66777", [S[0], S[4], S[5]], "Destination to add first. Price was for November 2025.")
  ];

  const person = (name, role, dept, kind) => ({ name, role, dept, kind, status: "Active", phone: "", email: "", links: [], notes: "Replace with the person's real name." });
  const team = [
    person("CEO", "Chief Executive Officer", "Management", "Full-time"),
    person("CFO", "Chief Financial Officer", "Finance", "Full-time"),
    person("CTO", "Chief Technology Officer", "Technology", "Full-time"),
    person("Sales lead", "Reservations", "Sales & Reservations", "Full-time"),
    person("Operations lead", "Operations", "Operations", "Full-time"),
    person("Content intern", "Trips and website content", "Trips & Content", "Intern"),
    person("Design intern", "Photos and graphics", "Trips & Content", "Intern"),
    person("Marketing intern", "Instagram and reviews", "Marketing", "Intern"),
    person("Ops intern", "Support and batches", "Operations", "Intern")
  ];

  const acc = (system, purpose, status, links, notes, givenTo) => ({ system, purpose, holder: "", givenTo: givenTo || "", keptIn: "", status, links: links || [], notes: notes || "" });
  const access = [
    acc("Company password manager", "One shared vault for every login below", "To be given", [], "Set this up first, then move every password into it.", "Everyone who needs a login"),
    acc("Admin dashboard", "Google sign-in, admin accounts only", "To confirm", L("Open", D), "List every Google account with admin access."),
    acc("Dashboard hosting (Vercel)", "Runs lux-dashord.vercel.app", "To confirm"),
    acc("Website hosting", "Runs www.luxpackers.com", "To confirm"),
    acc("Website server (Render)", "Trips, bookings and payments behind the website", "To confirm"),
    acc("Database and sign-in provider", "Stores trips, bookings and customers", "To confirm"),
    acc("Image storage (Cloudinary)", "Photos uploaded from the dashboard", "To confirm"),
    acc("Domain luxpackers.com", "Domain name and its renewal", "To confirm", [], "Note the renewal date."),
    acc("GitHub", "Code for the website, dashboard and this CRM", "To confirm"),
    acc("Business email", "twv@luxpackers.com", "To confirm"),
    acc("WhatsApp Business", "+91 79824 71691", "To confirm"),
    acc("Instagram", "@luxpackers", "To confirm", L("Open", "https://www.instagram.com/luxpackers/")),
    acc("Facebook and X", "/luxpackers · @luxpackers", "To confirm", L("Open", "https://www.facebook.com/luxpackers")),
    acc("Google Business Profile", "Google reviews", "To confirm"),
    acc("Payment gateway", "Online booking payments", "To confirm", [], "Finance and Technology only.")
  ];

  const partners = [
    { name: "Sayyed Effendi Hotel", kind: "Hotel", destination: "Cairo, Egypt", contact: "", phone: "", email: "", rating: "", status: "Active", owner: "Operations lead", links: [], notes: "Used for the Egypt trip, November 2025. Double rooms with daily breakfast." },
    { name: "Astoria Tbilisi", kind: "Hotel", destination: "Tbilisi, Georgia", contact: "", phone: "", email: "", rating: "", status: "Proposed", owner: "Operations lead", links: [], notes: "Proposed in the Georgia couple itinerary, 4 nights." },
    { name: "Grandeur Batumi", kind: "Hotel", destination: "Batumi, Georgia", contact: "", phone: "", email: "", rating: "", status: "Proposed", owner: "Operations lead", links: [], notes: "Proposed in the Georgia couple itinerary, 2 nights, sea-facing room." }
  ];

  window.LUX_SEED = { tasks, trips, team, access, partners, leads: [], bookings: [], finance: [], content: [] };
})();
