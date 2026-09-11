import { startG2Companion, markBridgeUnavailable } from "./bootstrap";

void startG2Companion("https://plus.tryatoms.app").catch(markBridgeUnavailable);
