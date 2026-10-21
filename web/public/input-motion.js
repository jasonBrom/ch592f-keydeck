// Exponential response is consistent at 30/60/144 Hz. Real device input
// reaches 95% of the new position in ~36 ms (key) or ~54 ms (rotation).
export function followInput(current,target,seconds,timeConstant){
 return current+(target-current)*-Math.expm1(-Math.max(0,seconds)/timeConstant);
}

// Viewed down the shaft, clockwise is negative rotation about Three.js +Y.
// A 20-pulse encoder produces 20 complete AB cycles per revolution, with or
// without mechanical detents. Configurations with fewer edges report more steps.
export function clockwiseAngle(steps,transitions=4,pulses=20){
 return -steps*transitions*2*Math.PI/(4*pulses);
}

// Absolute positions make a repeated status/iframe-ready message idempotent.
// Preserve the current preview orientation when entering live input mode.
export class LiveRotation {
 connected=false;position=0;angle=0;
 update(connected,position,current,transitions=4){
  if(!connected){this.connected=false;return current;}
  if(!this.connected){this.connected=true;this.position=0;this.angle=current;}
  if(Number.isSafeInteger(position)){
   this.angle+=clockwiseAngle(position-this.position,transitions);
   this.position=position;
  }
  return this.angle;
 }
}
