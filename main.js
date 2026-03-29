import * as BABYLON from "babylonjs";
import "babylonjs-loaders";

const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true);

const keysDown = new Set();
window.addEventListener("keydown", (e) => keysDown.add(e.key));
window.addEventListener("keyup", (e) => keysDown.delete(e.key));

let logged = false;
let scene;
let catRotationY = 0;
let catStats = { speed: 5, turnSpeed: 1 };
let catMesh, playerCamera;
let catAnimations = [];
let currentCatAnimation = "Idle";

const gravity = new BABYLON.Vector3(0, -0.15, 0);

const createScene = async () => {
    scene = new BABYLON.Scene(engine);
    scene.collisionsEnabled = true;

    const camera = new BABYLON.FollowCamera("camera", new BABYLON.Vector3(3, 23, -9), scene);
    const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(5, 3, 5), scene);

    const [catResult, mapResult] = await Promise.all([
        BABYLON.ImportMeshAsync("3d/cat.glb"),
        BABYLON.ImportMeshAsync("3d/Maze.glb")
    ]);

    catAnimations = catResult.animationGroups;
    catMesh = catResult.meshes[1];
    catMesh.setParent(null);

    catMesh.checkCollisions = true;
    catMesh.ellipsoid = new BABYLON.Vector3(1, 1, 1);
    catMesh.ellipsoidOffset = new BABYLON.Vector3(0, 1, 0);

    // maze - freeze and build octree for fast collision lookup
    mapResult.meshes.forEach(mesh => {
        mesh.checkCollisions = true;
        mesh.freezeWorldMatrix();
        mesh.isPickable = false;
        mesh.useOctreeForCollisions = true;
        mesh.useOctreeForRenderingSelection = true;
    });

    // ✅ build octree after all meshes are set up
    scene.createOrUpdateSelectionOctree(32, 2);

    camera.lockedTarget = catMesh;
    playerCamera = camera;
    camera.radius = 10;
    camera.heightOffset = 23;
    camera.rotationOffset = 180;
    camera.cameraAcceleration = 0.05;
    camera.maxCameraSpeed = 10;

    return scene;
};

createScene().then(s => {
    scene = s;
    engine.runRenderLoop(() => {
        Update();
        scene.render();
    });
});

window.addEventListener("resize", () => engine.resize());

function Update() {
    if (!catMesh) return;
    let deltaTime = engine.getDeltaTime() / 1000;
    let moveVector = BABYLON.Vector3.Zero();

    if (keysDown.has("w") || keysDown.has("ArrowUp")) moveVector.z += catStats.speed * deltaTime;
    else if (keysDown.has("s") || keysDown.has("ArrowDown")) moveVector.z -= catStats.speed * deltaTime;

    if (keysDown.has("a") || keysDown.has("ArrowLeft")) catRotationY -= catStats.turnSpeed * deltaTime;
    else if (keysDown.has("d") || keysDown.has("ArrowRight")) catRotationY += catStats.turnSpeed * deltaTime;

    catMesh.rotation.y = catRotationY;

    const rotatedVector = BABYLON.Vector3.TransformCoordinates(
        moveVector,
        BABYLON.Matrix.RotationY(catRotationY)
    );
    rotatedVector.y = gravity.y;
    catMesh.moveWithCollisions(rotatedVector);

    if (moveVector.length() === 0) playAnimation("Idle");
    else playAnimation("Run");

    logFrameRate();
}

function playAnimation(name) {
    if (currentCatAnimation === name) return;
    catAnimations.forEach(anim => anim.stop());
    const anim = catAnimations.find(a => a.name === name);
    if (anim) anim.play(true);
    currentCatAnimation = name;
}

function logFrameRate() {
    if (logged) return;
    setInterval(() => {
        console.log("FPS:", engine.getFps().toFixed());
    }, 1000);
    logged = true;
}