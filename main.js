import * as BABYLON from "babylonjs";
import "babylonjs-loaders";
import Recast from "recast-detour";

const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true, { adaptToDeviceRatio: false });

const keysDown = new Set();
window.addEventListener("keydown", (e) => keysDown.add(e.key));
window.addEventListener("keyup", (e) => keysDown.delete(e.key));

let fishCount = 0;

let logged = false;
let scene;
let catRotationY = 0;
let catStats = { speed: 6, turnSpeed: 1.2 };
let catMesh, playerCamera;
let catAnimations = [];
let currentCatAnimation = "Idle";
let groundY = 0;

//Dog
let dogMesh;
const DogState = Object.freeze({ 
  PATROLLING: 'PATROLLING',
  CHASING:    'CHASING',
  SEARCHING:  'SEARCHING',
});
let dogState = DogState.PATROLLING;
let dogInterestPoints = [];
let dogDestination = null;
let currentDogAnimation = "Walk";
let dogAnimations = [];
let navigationPlugin;
let crowd;
let dogAgentIndex = -1;
let dogStats = {
    speed: 3.5,
    chaseSpeed: 5.5,
}

let soundEffects = {};

let hedgeMesh;
const createScene = async () => {
    scene = new BABYLON.Scene(engine);
    scene.collisionsEnabled = true;

    initAudio();

    const camera = new BABYLON.FollowCamera("camera", new BABYLON.Vector3(3, 23, -9), scene);
    const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(5, 3, 5), scene);
    light.intensity = 1;

    const [catResult, mapResult, fishResult, dogResult,dogInterestPointsResult] = await Promise.all([
        BABYLON.ImportMeshAsync("3d/cat.glb"),
        BABYLON.ImportMeshAsync("3d/Maze.glb"),
        BABYLON.ImportMeshAsync("3d/fish.glb"),
        BABYLON.ImportMeshAsync("3d/dog.glb"),
        BABYLON.ImportMeshAsync("3d/dogInterestPoints.glb")
    ]);
    hedgeMesh = mapResult.meshes[1];
    fishResult.meshes[1].setParent(null);
    fishResult.meshes[1].isVisible = false;
    dogResult.meshes[1].setParent(null);
    dogResult.meshes[1].isVisible = false;
    dogMesh = dogResult.meshes[1];

    dogInterestPointsResult.meshes.forEach(mesh => {
        if(mesh.name == "__root__") return;
        mesh.computeWorldMatrix(true);
        dogInterestPoints.push(mesh.getAbsolutePosition().clone());
        mesh.isVisible = false;
        mesh.dispose();
    });

    catAnimations = catResult.animationGroups;
    catAnimations.forEach(animation => {
        animation.enableBlending = true;
    });
    dogAnimations = dogResult.animationGroups;
    dogAnimations.forEach(animation => {
        animation.enableBlending = true;
    });

    catMesh = catResult.meshes[1];
    catMesh.setParent(null);

    catMesh.checkCollisions = true;
    catMesh.ellipsoid = new BABYLON.Vector3(1, 1, 1);
    catMesh.ellipsoidOffset = new BABYLON.Vector3(0, 1, 0);

    initializeMap(mapResult);
    await initNavMesh(mapResult);

    let fishLocations = await getFishLocations();
    spawnFish(fishLocations, fishResult.meshes[1]);

    spawnDog();

    const cameraTarget = BABYLON.MeshBuilder.CreateBox("cameraTarget", { size: 0.1 }, scene);
    cameraTarget.isVisible = false;
    cameraTarget.isPickable = false;
    cameraTarget.position = new BABYLON.Vector3(0, 3, 4); // 3 units above, 2 ahead
    cameraTarget.setParent(catMesh);

    camera.lockedTarget = cameraTarget;
    playerCamera = camera;
    camera.radius = 12;
    camera.heightOffset = 15;
    camera.rotationOffset = 180;
    camera.cameraAcceleration = 0.1;
    camera.maxCameraSpeed = 0.8;

    logFrameRate();

    //performance optimizations
    scene.skipPointerMovePicking = true;
    scene.autoClearDepthAndStencil = false;
    scene.createOrUpdateSelectionOctree(32, 2);
    if (catMesh.material) {
        catMesh.material.freeze();
    }

    
    return scene;
};

createScene().then(s => {
    scene = s;
    engine.runRenderLoop(() => {
        Update();
        scene.render();
    });
});

//load audio and unlock on first interaction
async function initAudio() {
  const audioEngine = await BABYLON.CreateAudioEngineAsync();
  await audioEngine.unlockAsync();
  soundEffects.chomp = await BABYLON.CreateSoundAsync("chomp", "/sounds/chomp.mp3", scene);
  soundEffects.bark = await BABYLON.CreateSoundAsync("bark", "/sounds/bark.mp3", scene);
  soundEffects.sniff = await BABYLON.CreateSoundAsync("sniff", "/sounds/sniffing.mp3", scene);
}

window.addEventListener("resize", () => engine.resize());

function Update() {
    if (!catMesh) return;
    try{
        moveCat();
        checkFishPickup();
        updateDog();
    }
    catch(e){
        console.error("Error in Update loop:", e);
    }
}

function moveCat(){
    let deltaTime = engine.getDeltaTime() / 1000;
    let moveVector = BABYLON.Vector3.Zero();

    let isMoving = false;

    if (keysDown.has("w") || keysDown.has("ArrowUp")){ 
        moveVector.z += catStats.speed * deltaTime; 
        isMoving = true; 
    }
    else if (keysDown.has("s") || keysDown.has("ArrowDown")){ 
        moveVector.z -= catStats.speed * deltaTime; 
        isMoving = true;
    }

    if (keysDown.has("a") || keysDown.has("ArrowLeft")) {
        catRotationY -= catStats.turnSpeed * deltaTime; 
        isMoving = true;
    }
    else if (keysDown.has("d") || keysDown.has("ArrowRight")) {
        catRotationY += catStats.turnSpeed * deltaTime; 
        isMoving = true;
    }

    catMesh.rotation.y = catRotationY;

    const rotatedVector = BABYLON.Vector3.TransformCoordinates(
        moveVector,
        BABYLON.Matrix.RotationY(catRotationY)
    );

    // in Update(), temporarily replace moveWithCollisions with this:
    catMesh.moveWithCollisions(rotatedVector);

    catMesh.position.y = groundY;

    if (moveVector.length() > 0 && isMoving){
        playCatAnimation("Run");
    } 
    else if (moveVector.length() === 0 && isMoving){
        playCatAnimation("Turn");
    }
    else if (moveVector.length() === 0) {
        playCatAnimation("Idle");
    } 
    else {
        
    }
}

function playCatAnimation(name) {
    if (currentCatAnimation === name) return;
    catAnimations.forEach(anim => anim.stop());
    const anim = catAnimations.find(a => a.name === name);
    if (anim) {
        anim.blendingSpeed = 0.2;
        anim.play(true);
    }
    currentCatAnimation = name;
}

function logFrameRate() {
    if (logged) return;
    setInterval(() => {
        console.log("FPS:", engine.getFps().toFixed());
    }, 1000);
    logged = true;
}

function initializeMap(mapResult) {
    mapResult.meshes.forEach(mesh => {
        if (mesh.getTotalVertices() === 0) return;
    
        const bb = mesh.getBoundingInfo().boundingBox;
        const height = bb.maximumWorld.y - bb.minimumWorld.y;

        mesh.isPickable = false;
        mesh.useOctreeForCollisions = true;
        if (mesh.material) {
            mesh.material.freeze();
        }
        mesh.freezeNormals();
    });
    
    mapResult.meshes[1].checkCollisions = true; //hedge and walls collide
    mapResult.meshes[2].checkCollisions = true;
}

async function getFishLocations(){
    const fishLocations = await BABYLON.ImportMeshAsync("3d/fishSpawnLocations.glb")

    let locations = [];
    fishLocations.meshes.forEach(mesh => {
        if(mesh.name=="__root__") return;
        mesh.computeWorldMatrix(true);
        locations.push(mesh.getAbsolutePosition().clone());
        mesh.isVisible = false;
        mesh.dispose();
    });
    return locations;
}

function spawnFish(positions, mesh){
    positions.forEach(pos => {
        const bobbing = bobbingAnimation(pos.y);
        const rotation = rotationAnimation();
        const fish = mesh.clone("fish");
        fish.setParent(null);
        fish.position = pos.clone();
        fish.checkCollisions = true;
        fish.isVisible = true;
        fish.isPickable = false;

        //animations
        fish.rotationQuaternion = null;
        fish.rotation = new BABYLON.Vector3(-1* Math.PI / 2, 0, 0);
        fish.animations.push(bobbing);
        fish.animations.push(rotation);
        fish.animations = [bobbing, rotation];
        scene.beginDirectAnimation(fish, [bobbing, rotation], 0, 60, true);
    });
}



function checkFishPickup() {
    const PICKUP_DISTANCE = 2;
    scene.meshes.forEach(mesh => {
        if (mesh.name !== "fish" || !mesh.isVisible) return;
        if (BABYLON.Vector3.DistanceSquared(catMesh.position, mesh.position) < PICKUP_DISTANCE ** 3) {
            eatFish(mesh);
        }
    });
}

function rotationAnimation(){
    const rotationAnimation = new BABYLON.Animation("rotationAnimation", "rotation.y", 30, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE);
    const keys = [];
    keys.push({ frame: 0, value: 0 });
    keys.push({ frame: 60, value: 2 * Math.PI });
    rotationAnimation.setKeys(keys);
    return rotationAnimation;
}
function bobbingAnimation(startHeight = 0){
    const bobbingAnimation = new BABYLON.Animation("bobbingAnimation", "position.y", 30, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE);
    const keys = [];
    keys.push({ frame: 0, value: startHeight });
    keys.push({ frame: 30, value: startHeight + 0.8 });
    keys.push({ frame: 60, value: startHeight });
    bobbingAnimation.setKeys(keys);
    return bobbingAnimation;
}

function eatFish(fish) {
    fish.actionManager = null; // prevent double-trigger
    fish.isVisible = false;
    fish.checkCollisions = false;

    // Stop fish animations
    scene.stopAnimation(fish);
    scene.stopAnimation(fish.parent); // stop pivot bobbing if using parent node

    if(soundEffects.chomp){
        soundEffects.chomp.play();
    }
    
    updateFishCounter();
}

function updateFishCounter(newCount = (fishCount + 1)) {
    const counter = document.getElementById("fishCount");
    fishCount = newCount;
    counter.textContent = fishCount;
}

async function initNavMesh(mapResult) {
    const recast = await new Recast();
    navigationPlugin = new BABYLON.RecastJSPlugin(recast);

    const navMeshParameters = {
        cs: 0.3,
        ch: 0.2,
        walkableSlopeAngle: 35,
        walkableHeight: 2,
        walkableClimb: 1,
        walkableRadius: 1,
        maxEdgeLen: 12,
        maxSimplificationError: 1.3,
        minRegionArea: 8,
        mergeRegionArea: 20,
        maxVertsPerPoly: 6,
        detailSampleDist: 6,
        detailSampleMaxError: 1,
    };

    // pass the floor/ground mesh(es) — the navmesh is baked from geometry
    const navMeshes = [mapResult.meshes[3]];
    navigationPlugin.createNavMesh(navMeshes, navMeshParameters);

    // const debugMesh = navigationPlugin.createDebugNavMesh(scene); //NAVMESH DEBUG CODE
    // const debugMat = new BABYLON.StandardMaterial("navDebug", scene);
    // debugMat.diffuseColor = new BABYLON.Color3(0.1, 0.2, 1);
    // debugMat.alpha = 0.2;
    // debugMesh.material = debugMat; 

    crowd = navigationPlugin.createCrowd(1, 0.5, scene);
}

// -----------------------------DOG---------------------------------
async function spawnDog() {
    const dogSpawnResult = await BABYLON.ImportMeshAsync("3d/dogSpawnPoint.glb");
    const spawnMesh = dogSpawnResult.meshes.find(m => m.name !== "__root__");
    spawnMesh.computeWorldMatrix(true);
    const spawnPos = spawnMesh.getAbsolutePosition().clone();
    spawnMesh.dispose();

    dogMesh.position = new BABYLON.Vector3(spawnPos.x, groundY, spawnPos.z);
    dogMesh.isVisible = true;
    dogState = DogState.PATROLLING;

    // add dog as a crowd agent
    const agentParams = {
        radius: 0.5,
        height: 1.5,
        maxAcceleration: 4.0,
        maxSpeed: 3.5,
        collisionQueryRange: 0.5,
        pathOptimizationRange: 0.0,
        separationWeight: 1.0,
    };
    const closestPoint = navigationPlugin.getClosestPoint(dogMesh.position);
    dogAgentIndex = crowd.addAgent(closestPoint, agentParams, dogMesh);
    setInterval(() => { //check line of sight every 250ms (quarter of a second)
        checkDogLineOfSight();
    }, 250);
}

let dogSniffingTimeout;
function updateDog() {
    if (!dogMesh || dogAgentIndex < 0 || !crowd) return;

    // face direction of travel
    const velocity = crowd.getAgentVelocity(dogAgentIndex);
    if (velocity.length() > 0.2) {
        dogMesh.rotation.y = Math.atan2(velocity.x, velocity.z);
    }

    if (dogState === DogState.PATROLLING) {
        playDogAnimation("Dog_Walk");
        if (!dogDestination || BABYLON.Vector3.DistanceSquared(dogMesh.position, dogDestination) < 6) {
            dogDestination = null;
            dogDestination = chooseDogInterestPoint();
            if (dogDestination) {
                const closest = navigationPlugin.getClosestPoint(dogDestination);
                crowd.agentGoto(dogAgentIndex, closest);
            }
        }
    } else if (dogState === DogState.CHASING) {
        playDogAnimation("Dog_Run");
        const closest = navigationPlugin.getClosestPoint(catMesh.position);
        crowd.agentGoto(dogAgentIndex, closest);
    }
    else if (dogState === DogState.SEARCHING) {
        if (!dogDestination || BABYLON.Vector3.DistanceSquared(dogMesh.position, dogDestination) < 6) {
            if(!dogSniffingTimeout){
                playDogAnimation("Dog_Walk");
                soundEffects.sniff.play();
                crowd.updateAgentParameters(dogAgentIndex, { maxSpeed: 0 });
                dogSniffingTimeout = setTimeout(() => {
                    dogSniffingTimeout = null;
                    if(dogState !== DogState.SEARCHING) return; //prevent timeout from triggering if state changed
                    crowd.updateAgentParameters(dogAgentIndex, { maxSpeed: dogStats.speed });
                    startPatrolling();
                    dogSniffingTimeout = null;
                },4000);
            }
        }
        else{
            playDogAnimation("Dog_Run");
        }
    }
}
function chooseDogInterestPoint(){
    if(dogInterestPoints.length === 0) return null;
    const index = Math.floor(Math.random() * dogInterestPoints.length);
    if(dogInterestPoints[index].equals(dogDestination)) {
        return chooseDogInterestPoint();
    }
    return dogInterestPoints[index];
}
function playDogAnimation(name) {
    if (currentDogAnimation === name) return;
        dogAnimations.forEach(anim => anim.stop());
        const anim = dogAnimations.find(a => a.name === name);
    if (anim) {
        anim.blendingSpeed = 0.2;
        anim.play(true);
    }
    currentDogAnimation = name;
}
function checkDogLineOfSight() {
    if (!dogMesh || !catMesh) return;

    const from = dogMesh.position.clone();
    const to = catMesh.position.clone();
    from.y += 1; // eye height
    to.y += 1;

    const direction = to.subtract(from).normalize();
    const distance = BABYLON.Vector3.Distance(from, to);
    const ray = new BABYLON.Ray(from, direction, distance);

    const hit = scene.pickWithRay(ray, (mesh) => {
        // only care about walls/hedges blocking LOS
        return mesh === hedgeMesh;
    });

    const canSee = !hit.hit;

    if (canSee && (dogState === DogState.PATROLLING || dogState === DogState.SEARCHING)) {
        beginChase();
    } else if (!canSee && dogState === DogState.CHASING) {
        startDogSearch();
    }
}
function beginChase(){
    dogState = DogState.CHASING;
    const closest = navigationPlugin.getClosestPoint(catMesh.position);
    crowd.agentGoto(dogAgentIndex, closest);
    crowd.updateAgentParameters(dogAgentIndex, { maxSpeed: dogStats.chaseSpeed });
    soundEffects.bark.play();
    soundEffects.sniff.stop();
    if(dogSniffingTimeout){
        clearTimeout(dogSniffingTimeout);
        dogSniffingTimeout = null;
    }
}
function startDogSearch(){
    dogState = DogState.SEARCHING;
    dogDestination = catMesh.position.clone();
    const closest = navigationPlugin.getClosestPoint(dogDestination);
    crowd.agentGoto(dogAgentIndex, closest);
}
function startPatrolling(){
    dogState = DogState.PATROLLING;
    dogDestination = null;
}