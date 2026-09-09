import { markBridgeUnavailable, startG2Companion } from "./bootstrap";

void startG2Companion("https://plus.tryatoms.app").catch(markBridgeUnavailable);
