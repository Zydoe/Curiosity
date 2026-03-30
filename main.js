import * as BABYLON from "babylonjs";
import "babylonjs-loaders";

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

let soundEffects = {};

const createScene = async () => {
    scene = new BABYLON.Scene(engine);
    scene.collisionsEnabled = true;

    initAudio();

    const camera = new BABYLON.FollowCamera("camera", new BABYLON.Vector3(3, 23, -9), scene);
    const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(5, 3, 5), scene);
    light.intensity = 1;

    const [catResult, mapResult, fishResult] = await Promise.all([
        BABYLON.ImportMeshAsync("3d/cat.glb"),
        BABYLON.ImportMeshAsync("3d/Maze.glb"),
        BABYLON.ImportMeshAsync("3d/fish.glb")
    ]);
    fishResult.meshes[1].setParent(null);
    fishResult.meshes[1].isVisible = false;

    catAnimations = catResult.animationGroups;
    catAnimations.forEach(animation => {
        animation.enableBlending = true;
    });

    catMesh = catResult.meshes[1];
    catMesh.setParent(null);

    catMesh.checkCollisions = true;
    catMesh.ellipsoid = new BABYLON.Vector3(1, 1, 1);
    catMesh.ellipsoidOffset = new BABYLON.Vector3(0, 1, 0);

    initializeMap(mapResult);

    let fishLocations = await getFishLocations();
    spawnFish(fishLocations, fishResult.meshes[1]);

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
}

window.addEventListener("resize", () => engine.resize());

function Update() {
    if (!catMesh) return;
    moveCat();
    checkFishPickup();
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
        playAnimation("Run");
    } 
    else if (moveVector.length() === 0 && isMoving){
        playAnimation("Turn");
    }
    else if (moveVector.length() === 0) {
        playAnimation("Idle");
    } 
    else {
        
    }
}

function playAnimation(name) {
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

        mesh.freezeWorldMatrix();
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
        if (BABYLON.Vector3.DistanceSquared(catMesh.position, mesh.position) < PICKUP_DISTANCE ** 2) {
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

    // Stop its animations
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