# Group rides, races and the race commentator

This page covers the scheduled **Events** (a race every evening and a group ride at midday), how the synchronised start works, the results, and the race commentator.

## Events

Open **☰ Menu → 🗓 Events**. It lists what is on over the next two days, with a countdown and a **Join** button, then the events that have finished. Times are shown in your own time zone. You need to be signed in to join (the daily schedule is visible to everyone).

| Event | When | Where | What |
| --- | --- | --- | --- |
| **Evening race** | Every day at 19:30 UTC | A different stage each day, rotating through the Hell of the West stages, Alpe d'Huez, Stelvio, Ventoux, Tourmalet, Zoncolan and Route 66 | A race against the computer-ridden pro field and any other riders who join |
| **Group ride** | Every day at 12:30 UTC | Heartland Rollers | A steady bunch at 2.6 W/kg for 90 minutes |
| **One-off events** | Whenever an admin adds one | Any stage | A race or a group ride, with its own title |

The schedule creates itself, so there is always something on.

## Joining

You can join from an hour before the start. Press **Join**:

1. The app switches to the event's stage and puts you on the start line. A bar at the top shows the countdown and how many other riders are on the line with you. You can't move until the start. **Leave** takes you out again.
2. Riders in the same event see each other, and only each other. Your rider-together setting still applies: with **Ride together** off you won't see anyone, and nobody sees you.
3. The **3, 2, 1** starts at the same moment for everyone, by the server's clock (your computer's clock doesn't matter).
4. You can still join a race up to five minutes after the start, and a group ride up to 20 minutes after. A late rider starts from the line while the field is already racing, and their time counts from the event's start.

### Races

Everyone in an evening race faces the **same computer-ridden field** (the event has a seed that decides the riders, their attacks and the break). The field is set to a fixed 3.4 W/kg rather than scaled to you, so the race is the same for everybody: if that is too hot for you, you'll be dropped like in a real race.

When you finish, the finish card shows one table with the real riders and the computer-ridden riders merged by time. Real riders who finish after you appear as they come in (the card looks again every 15 seconds). Afterwards, the results stay in the Events dialog under **Finished**; press **Results**.

Rules for a result to count:

- Only your first result in an event is kept.
- Demo rides and rides with `?timescale` don't send a result (the card says so).
- The server checks the time against the start (you can't take longer than has passed or finish before it's possible) and that your average power is sensible.

### Group rides

The pace group holds 2.6 W/kg all the way, with 12 riders. Sit in the group for shelter. If you fall more than **100 m** off the back, you'll get a short, friendly "you've been dropped" note, and another when you're back (the group doesn't wait or slow down). The bar at the top says how far you are from the group. A group ride has no result or finish: it ends after 90 minutes.

## The race commentator

In every race (a stage race, a tour stage or an event) a commentator calls the action with short voice lines:

- the start, attacks, the breakaway forming and being caught, the gap growing or closing, intermediate sprints, the summit of a climb, halfway, the last kilometre and the sprint;
- and lines about **you**: when you attack, lead the race, are dropped, fight back on, wear the yellow jersey in a tour stage, or finish (a win, the podium, or just crossing the line).

He never talks over himself: one line at a time, a pause between lines, and the same kind of line is not repeated for a minute or so. The ride sounds drop a little while he speaks. The lines are made-up and don't name real people or teams.

Turn it off with **Race commentary** in ⚙ Settings. It follows the sound switch: with **☰ Menu → 🔊 Sound** off, he's silent too.

## For admins

Admins can add one-off events from the Admin dashboard. See [Admin dashboard](../admin-guide/admin-dashboard.md#group-rides-and-races).
