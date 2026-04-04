import * as BABYLON from "babylonjs";
import "babylonjs-loaders";
import Recast from "recast-detour";

const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true, { adaptToDeviceRatio: false });

const keysDown = new Set();
window.addEventListener("keydown", (e) => keysDown.add(e.key));
window.addEventListener("keyup", (e) => keysDown.delete(e.key));
document.getElementById("pauseHighScoreValue").textContent = localStorage.getItem("highScore") || 0;
//pause menu
let menu =  document.querySelector(".pauseMenu");
document.getElementById("startButton").addEventListener("click", () => {
    menu.style.display = "none";
    beginGame();
});
document.getElementById("resetButton").addEventListener("click", () => {
    resetGame();
    menu.style.display = "none";
    movementEnabled = true;
    dogMovementEnabled = true;
});
document.getElementById("deathResetButton").addEventListener("click", () => {
    hideDeathScreen();
    resetGame();
    movementEnabled = true;
    dogMovementEnabled = true;
});
let deathScreen = document.getElementById("deathScreen");

function showDeathScreen(){
    document.getElementById("currentScoreValue").textContent = fishCount;
    document.getElementById("highScoreValue").textContent = localStorage.getItem("highScore") || 0;
    deathScreen.classList.toggle("active",true);
}
function hideDeathScreen(){
    deathScreen.classList.toggle("active",false);
}

document.addEventListener("keydown", (e) => { //pause menu toggle
    if (e.key === "Escape" && movementEnabled) {
        document.getElementById("pauseHighScoreValue").textContent = localStorage.getItem("highScore") || 0;
        menu.style.display = "block";
        movementEnabled = false;
        dogMovementEnabled = false;
    }
    else if (e.key === "Escape" && !movementEnabled) {
        menu.style.display = "none";
        movementEnabled = true;
        dogMovementEnabled = true;
    }
});
const animateRadiusTo = (targetRadius, durationSeconds = 1.5) => { //camera animation for when player dies and radius expands to show whole map
    const fps = 60;
    const totalFrames = fps * durationSeconds;

    const radiusAnim = new BABYLON.Animation(
        "cameraRadiusAnim",
        "radius",
        fps,
        BABYLON.Animation.ANIMATIONTYPE_FLOAT,
        BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
    );

    radiusAnim.setKeys([
        { frame: 0,           value: playerCamera.radius },
        { frame: totalFrames, value: targetRadius }
    ]);

    const ease = new BABYLON.CubicEase();
    ease.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT);
    radiusAnim.setEasingFunction(ease);

    playerCamera.animations = [radiusAnim];
    scene.beginAnimation(playerCamera, 0, totalFrames, false);
};

//game
let fishCount = 0;
let fishTemplate;
let allFish = [];
let fishSpawnPoints;
let movementEnabled = false;
let dogMovementEnabled = false;
let soundEffects = {};
let hedgeMesh;

//camera
let playerCamera;
let introCamera;


//player character
let logged = false;
let scene;
let catRotationY = 0;
let catStats = { speed: 6, turnSpeed: 1.2 };
let catMesh;
let catAnimations = [];
let currentCatAnimation = "Idle";
let groundY = 0;

//Dog
let dogMesh;
let dogSpawnPoint;
const DogState = Object.freeze({ 
  PATROLLING: 'PATROLLING',
  CHASING:    'CHASING',
  SEARCHING:  'SEARCHING',
});
let dogState = DogState.PATROLLING;
let dogInterestPoints = [];
let dogDestination = null;
let currentDogAnimation = "Dog_Walk";
let dogAnimations = [];
let navigationPlugin;
let crowd;
let dogAgentIndex = -1;
let dogStats = {
    speed: 3.5,
    chaseSpeed: 5.5,
}
let dogLOSCheck;


const createScene = async () => {
    scene = new BABYLON.Scene(engine);
    scene.collisionsEnabled = true;

    initAudio();

    

    const camera = new BABYLON.FollowCamera("camera", new BABYLON.Vector3(3, 23, -9), scene);
    

    

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
    fishTemplate = fishResult.meshes[1];
    fishTemplate.name = "fishTemplate";
    fishTemplate.setEnabled(false);
    fishTemplate.checkCollisions = false;
    dogResult.meshes[1].setParent(null);
    dogResult.meshes[1].isVisible = false;
    dogMesh = dogResult.meshes[1];
    dogResult.meshes.forEach(mesh => {
        mesh.alwaysSelectAsActiveMesh = true;
    });

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

    fishSpawnPoints = await getFishLocations();
    createFish(fishSpawnPoints, fishTemplate);

    const dogSpawnResult = await BABYLON.ImportMeshAsync("3d/dogSpawnPoint.glb");
    dogSpawnPoint = dogSpawnResult.meshes.find(m => m.name !== "__root__");
    dogSpawnPoint.checkCollisions = false;

    spawnDog();

    //lighting
    const light = new BABYLON.DirectionalLight("light", new BABYLON.Vector3(-1, -2, -0.2), scene);
    light.position = new BABYLON.Vector3(20, 60, 20);
    light.intensity = 4;

    const ambientLight = new BABYLON.HemisphericLight("ambient", new BABYLON.Vector3(0, 1, 0), scene);
    ambientLight.intensity = 0.4;

    const shadowGenerator = new BABYLON.ShadowGenerator(1024, light);
    shadowGenerator.useBlurExponentialShadowMap = true;

    shadowGenerator.addShadowCaster(catMesh);
    shadowGenerator.addShadowCaster(dogMesh);
    shadowGenerator.addShadowCaster(hedgeMesh);

    catMesh.receiveShadows = true;
    dogMesh.receiveShadows = true;
    mapResult.meshes.forEach(mesh => {
        mesh.receiveShadows = true;
    });


    //camera
    const cameraTarget = BABYLON.MeshBuilder.CreateBox("cameraTarget", { size: 0.1 }, scene);
    cameraTarget.isVisible = false;
    cameraTarget.isPickable = false;
    cameraTarget.position = new BABYLON.Vector3(0, 3, 4); // 3 units above, 2 ahead
    cameraTarget.setParent(catMesh);

    camera.lockedTarget = cameraTarget;
    playerCamera = camera;
    setCameraToFollow();

    //Skybox
    const skybox = BABYLON.MeshBuilder.CreateBox("skyBox", { size: 1000 }, scene);
    const skyboxMat = new BABYLON.StandardMaterial("skyBoxMat", scene);
    skyboxMat.backFaceCulling = false;
    skyboxMat.disableLighting = true;

    const hdrTexture = new BABYLON.HDRCubeTexture("/images/sky_2k.hdr", scene, 512);
    hdrTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
    hdrTexture.rotationY = BABYLON.Tools.ToRadians(-120);
    skyboxMat.reflectionTexture = hdrTexture;
    hdrTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;

    skybox.material = skyboxMat;
    skybox.infiniteDistance = true;

    logFrameRate();

    //performance optimizations
    scene.skipPointerMovePicking = true;
    scene.autoClearDepthAndStencil = false;
    if (catMesh.material) {
        catMesh.material.freeze();
    }

    introCamera = new BABYLON.ArcRotateCamera("introCamera", 
        Math.PI / 2,  //horizontal
        Math.PI / 2.2, //vertical
        6, //distance
        catMesh.position.clone(),scene
    );

    scene.activeCamera = introCamera;


    return scene;
};


function beginGame(){
    if(!introCamera || !playerCamera) return;
    let destination = playerCamera.position.clone();
    //pan intro camera to player camera position over 3 seconds, then switch to player camera
    const animation = new BABYLON.Animation("introPan", "position", 30, BABYLON.Animation.ANIMATIONTYPE_VECTOR3, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
    const keys = [];
    keys.push({ frame: 0, value: introCamera.position.clone() });
    keys.push({ frame: 90, value: destination });
    animation.setKeys(keys);
    introCamera.animations.push(animation);
    scene.beginAnimation(introCamera, 0, 90, false, 1, () => {
        scene.activeCamera = playerCamera;
       introCamera.dispose();
    });
    movementEnabled = true;
    dogMovementEnabled = true;
}

function resetGame(){
    updateFishCounter(0);
    setCameraToFollow();

    //reset cat
    catMesh.position = new BABYLON.Vector3(0, groundY, 0);
    catRotationY = 0;
    catMesh.isVisible = true;
    catMesh.position = new BABYLON.Vector3(0, groundY, 0);
    catMesh.checkCollisions = true;
    catMesh.computeWorldMatrix(true);
    playCatAnimation("Idle");
    

    //reset dog
    dogDestination = null;
    if (dogSniffingTimeout) {
        clearTimeout(dogSniffingTimeout);
        dogSniffingTimeout = null;
    }
    soundEffects.bark.stop();
    soundEffects.sniff.stop();
    dogState = DogState.PATROLLING;
    const closest = navigationPlugin.getClosestPoint(dogSpawnPoint.getAbsolutePosition());
    crowd.agentTeleport(dogAgentIndex, closest);


    //respawn fish
    resetFish();


    movementEnabled = true;
    dogMovementEnabled = true;
}

function setCameraToFollow(){
    scene.activeCamera = playerCamera;
    playerCamera.cameraAcceleration = 0.2;
    playerCamera.radius = 12;
    playerCamera.heightOffset = 15;
    playerCamera.rotationOffset = 180;
    playerCamera.minZ = 0.1;
    playerCamera.maxZ = 5000;
}


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
    soundEffects.sniff = await BABYLON.CreateSoundAsync("sniff", "/sounds/sniffing.mp3", {loop: false, spatialEnabled: true, maxDistance: 30});
    soundEffects.death = await BABYLON.CreateSoundAsync("death", "/sounds/deathScream.mp3", scene);
    soundEffects.walking = await BABYLON.CreateSoundAsync("walking", "/sounds/catWalk.mp3", { loop: true, autoplay: false });
    soundEffects.dogWalking = await BABYLON.CreateSoundAsync("walking", "/sounds/dogWalk.mp3", { loop: true, autoplay: false, spatialEnabled: true, maxDistance: 5 });
    //soundEffects.dogWalking.attachToMesh(dogMesh);
   // soundEffects.sniff.attachToMesh(dogMesh);
    soundEffects.walking.setVolume(0);
    soundEffects.walking.play();
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
    if(dogMesh && !dogMesh.isVisible) {
            console.trace("Dog is invisible!");
        }
}

function moveCat(){
    if(!movementEnabled) return;
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
    if(soundEffects.walking){
        if(isMoving){
            soundEffects.walking.setVolume(1);
        }
        else {
            soundEffects.walking.setVolume(0);
        }
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

    const root = fishLocations.meshes.find(m => m.name === "__root__");
    if (root) root.computeWorldMatrix(true);
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

function createFish(positions, mesh){
    mesh.setParent(null);
    positions.forEach(pos => {
        mesh.checkCollisions = false;
        mesh.computeWorldMatrix(true);
        const bobbing = bobbingAnimation(pos.y);
        const rotation = rotationAnimation();
        const fish = mesh.clone("fish", null, true);
        allFish.push(fish);
        fish.setParent(null);
        fish.position = pos.clone();
        fish.setEnabled(true);
        fish.checkCollisions = false;
        fish.isVisible = true;
        fish.visibility = 1;
        fish.isPickable = false;

        //animations
        fish.rotationQuaternion = null;
        fish.rotation = new BABYLON.Vector3(-1* Math.PI / 2, 0, 0);
        fish.animations.push(bobbing);
        fish.animations.push(rotation);
        fish.animations = [bobbing, rotation];
        fish.computeWorldMatrix(true);
        fish.refreshBoundingInfo();
        scene.beginDirectAnimation(fish, [bobbing, rotation], 0, 60, true);
    });
}

function resetFish(){
    allFish.forEach(fish => {
        fish.isVisible = true;
    });
}



function checkFishPickup() {
    const PICKUP_DISTANCE = 2;
    allFish.forEach(fish => {
        if (!fish.isVisible) return;
        if (BABYLON.Vector3.DistanceSquared(catMesh.position, fish.position) < PICKUP_DISTANCE ** 3) {
            eatFish(fish);
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
    if (!fish.isVisible) return;
    fish.actionManager = null; // prevent double-trigger
    fish.isVisible = false;
    fish.checkCollisions = false;

    if(soundEffects.chomp){
        soundEffects.chomp.play();
    }
    
    updateFishCounter();
    checkHighScore();
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
    if (dogLOSCheck !== null) {
        clearInterval(dogLOSCheck);
        dogLOSCheck = null;
    }
    
    dogSpawnPoint.computeWorldMatrix(true);
    const spawnPos = dogSpawnPoint.getAbsolutePosition().clone();
    dogSpawnPoint.isVisible = false;
    dogSpawnPoint.collisionsEnabled = false;

    dogMesh.position = new BABYLON.Vector3(spawnPos.x, groundY, spawnPos.z);
    dogMesh.isVisible = true;
    dogState = DogState.PATROLLING;

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
    dogMesh.alwaysSelectAsActiveMesh = true;
    if (dogAgentIndex >= 0) {
        crowd.updateAgentParameters(dogAgentIndex, agentParams);
        crowd.agentTeleport(dogAgentIndex, closestPoint);
        crowd.agentGoto(dogAgentIndex, closestPoint);
    }else {
        dogAgentIndex = crowd.addAgent(closestPoint, agentParams, dogMesh);
    }
    dogLOSCheck = setInterval(() => { //check line of sight every 250ms (quarter of a second)
        checkDogLineOfSight();
    }, 250);
}

let dogSniffingTimeout;
function updateDog() {
    if(!dogMovementEnabled) return;
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
        checkDogCaughtCat();
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
function checkDogCaughtCat(){
    if(!dogMovementEnabled) return;
    const CATCH_DISTANCE = 1.5;
    if (BABYLON.Vector3.DistanceSquared(dogMesh.getAbsolutePosition(), catMesh.getAbsolutePosition()) < CATCH_DISTANCE ** 2) {
        OnCatDeath();
    }
}
function OnCatDeath(){
    movementEnabled = false;
    dogMovementEnabled = true; //freeze player movement while caught animation plays
    soundEffects.death.play();
    spawnBloodExplosion(catMesh.getAbsolutePosition());
    catMesh.isVisible = false;
    catMesh.checkCollisions = false;
    soundEffects.walking.setVolume(0);
    startPatrolling();
    setTimeout(() => {
        animateRadiusTo(50, 5); //expand camera radius to show whole map
        showDeathScreen();
    }, 2000);
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
    if(!catMesh.isVisible) return; //lets dog return to patrolling if cat is dead
    if (!dogMovementEnabled) return;

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
function spawnBloodExplosion(position) {
    const particles = new BABYLON.ParticleSystem("blood", 200, scene);
    
    // use a simple built-in texture for the particles
    particles.particleTexture = createBloodTexture(scene);

    particles.emitter = position.clone();
    
    // colors
    particles.color1 = new BABYLON.Color4(0.4, 0, 0, 1);      // bright red
    particles.color2 = new BABYLON.Color4(0.2, 0, 0, 1);      // dark red
    particles.colorDead = new BABYLON.Color4(0.1, 0, 0, 0.6);   // fade to black/transparent

    // size
    particles.minSize = 0.1;
    particles.maxSize = 0.4;

    // lifetime
    particles.minLifeTime = 0.5;
    particles.maxLifeTime = 2;

    // speed
    particles.minEmitPower = 1;
    particles.maxEmitPower = 3;
    particles.updateSpeed = 0.02;

    // burst — emit all at once then stop
    particles.manualEmitCount = 200;
    particles.maxEmitBox = new BABYLON.Vector3(0.1, 0.1, 0.1);

    // spray in all directions
    particles.direction1 = new BABYLON.Vector3(-1, 2, -1);
    particles.direction2 = new BABYLON.Vector3(1, 4, 1);

    // gravity pulls them down
    particles.gravity = new BABYLON.Vector3(0, -9.81, 0);

    particles.start();

    // auto dispose after the longest particle lifetime
    setTimeout(() => particles.dispose(), 2000);
}
function createBloodTexture(scene) {
    // Create an offscreen canvas
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    const center = size / 2;
    const radius = size / 2;

    // Radial gradient: dark red core fading to transparent
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius);
    gradient.addColorStop(0.0, "rgba(255, 30, 0, 1)");    // bright red-orange core
    gradient.addColorStop(0.2, "rgba(180, 0, 0, 1)");     // deep red
    gradient.addColorStop(0.5, "rgba(80, 0, 0, 0.8)");    // dark red mid
    gradient.addColorStop(0.8, "rgba(20, 0, 0, 0.3)");    // near-black edge
    gradient.addColorStop(1.0, "rgba(0, 0, 0, 0)");       // fully transparent

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fill();

    // Wrap the canvas in a Babylon DynamicTexture
    const texture = new BABYLON.DynamicTexture("orbTexture", { width: size, height: size }, scene);
    const texCtx = texture.getContext();

    // Copy canvas pixels into the DynamicTexture
    texCtx.drawImage(canvas, 0, 0);
    texture.update();

    return texture;
}

function checkHighScore(){
    const highScore = localStorage.getItem("highScore") || 0;
    if(fishCount > highScore){
        localStorage.setItem("highScore", fishCount);
    }
}