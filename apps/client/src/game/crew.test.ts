import { describe, expect, it } from "vitest";
import { crewAttrs, crewCaption, crewComplete, crewCompletePrice, crewSlots, parseCrewAttrs, parseCrewDefinitions } from "./crew";
import { fetchText } from "../../test/helpers";

const defs = parseCrewDefinitions(await fetchText("crewMechanicsDefinition.xml"));
const club = defs.get("crew_01")!;

describe("crew mechanics", () => {
  it("parses crewMechanicsDefinition.xml (3 jobs, 2 gold / 5 FBC)", () => {
    expect(club.jobs).toEqual(["TID_CREW_01_JOB_01", "TID_CREW_01_JOB_02", "TID_CREW_01_JOB_03"]);
    expect(club).toMatchObject({ goldPrice: 2, fbcPrice: 5, workerTid: "TID_CREW_01_WORKER" });
  });

  it("slots: bought indices first, hired friends fill the next ones, the rest are free (PopupHireCrew :51-83)", () => {
    const c = parseCrewAttrs("fb1", "2");
    expect(crewSlots(club, c).map((s) => [s.status, s.friend])).toEqual([["hired", "fb1"], ["free", undefined], ["bought", undefined]]);
    expect(crewCaption(club, c)).toBe("2/3");
    expect(crewCompletePrice(club, c)).toBe(2);
    expect(crewComplete(club, c)).toBe(false);
  });

  it("complete when every slot is filled; <Crew> attributes round trip", () => {
    const c = parseCrewAttrs("", "0,1,2");
    expect(crewComplete(club, c)).toBe(true);
    expect(crewCompletePrice(club, c)).toBe(0);
    expect(crewAttrs(c)).toEqual({ ids: "", bought: "0,1,2" });
  });
});
