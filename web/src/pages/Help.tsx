import { Link } from "react-router-dom";
import { TASK_STATUSES } from "../../../shared/schema";
import { Pill, taskTone } from "../components/Pill";
import { useTitle } from "../lib/useTitle";

const HINTS: Record<(typeof TASK_STATUSES)[number], string> = {
  "To do": "Not started yet.",
  "In progress": "You are working on it now.",
  Waiting: "You need something from someone else. Write who in “Waiting on”.",
  Blocked: "You cannot move forward and need help. Say why in a comment.",
  Submitted: "Finished, and sent to the person who gave it to you to check.",
  Done: "Checked and finished.",
};

export function Help() {
  useTitle("How to use");
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Guide</div>
          <h1>How to use the desk</h1>
          <p>Five minutes to read. Everything here is written for people who are not technical.</p>
        </div>
      </div>
      <div className="card card-pad prose">
        <h2>The idea</h2>
        <p>Everything the company has to do lives here, in one place. Each item has <b>one owner</b>, <b>one date</b> and <b>one status</b>. When something changes, change it here the same day, so everyone sees the truth without asking.</p>
        <h2>What the task statuses mean</h2>
        <ul>
          {TASK_STATUSES.map((s) => (
            <li key={s}><Pill tone={taskTone[s]}>{s}</Pill> — {HINTS[s]}</li>
          ))}
        </ul>
        <h2>Everyday steps</h2>
        <ol>
          <li><b>Find your work:</b> open <Link to="/tasks">My tasks</Link>. Late tasks and tasks due today come first.</li>
          <li><b>Change a status:</b> open a task and pick the new status. It saves straight away.</li>
          <li><b>Finished something someone gave you?</b> Press <b>Submit</b>. They will check it and mark it done, or send it back with a note.</li>
          <li><b>Add a link:</b> give it a name (for example “Quote PDF”) and paste the address. Links must start with https://.</li>
          <li><b>Need time off?</b> Open <Link to="/leave">Leave</Link> and ask. The person who approves leave for your team will see it.</li>
          <li><b>Find anything:</b> type in the search box at the top: a guest's name, a trip, a colleague.</li>
          <li><b>The bell</b> at the top right tells you when something needs you. Press a message to go straight to it.</li>
        </ol>
        <h2>Why your menu looks the way it does</h2>
        <p>Everyone has one <b>position</b>, for example Employee, Manager or Finance Head. The position decides what is in your menu:</p>
        <ul>
          <li><b>Tasks</b> — only your own, your team's, or everyone's.</li>
          <li><b>Leave</b> — whose leave requests you can approve, if anyone's.</li>
          <li><b>Registers</b> — each register is hidden, view only, editable, or editable with delete.</li>
          <li><b>People</b> — basic contact details, or full details with onboarding. Some positions can also add new employees.</li>
        </ul>
        <p>If you need something that isn't in your menu, ask the administrator to change your position.</p>
        <h2>For the administrator</h2>
        <ul>
          <li><b>Positions:</b> open <b>Positions</b> under Admin, press <b>Create a position</b>, give it a name and choose what it can open. Changes reach everyone in that position straight away.</li>
          <li><b>Adding someone:</b> open <b>People &amp; logins</b>, press <b>Add a person</b>, choose their position, and type or generate a password. Give it to them in person.</li>
          <li><b>Forgotten password:</b> press <b>Set a new password</b> next to their name. It signs them out everywhere. Passwords can't be viewed — only set.</li>
          <li>A position can only be deleted when no one is in it. Move the people first.</li>
        </ul>
        <h2>Two rules</h2>
        <ul>
          <li><b>No passwords, OTPs or card numbers</b> anywhere in this CRM. The Access register records only who holds a login and where it is kept.</li>
          <li><b>Only some positions can delete.</b> If something was added by mistake, change its status or ask someone who can.</li>
        </ul>
      </div>
    </>
  );
}
